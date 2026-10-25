/**
 * Applique les migrations SQL de db/migrations dans l'ordre, chacune dans une
 * transaction, puis réapplique les droits du rôle applicatif.
 * Utilise DATABASE_OWNER_URL (propriétaire du schéma), jamais DATABASE_URL.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!url) throw new Error("DATABASE_OWNER_URL manquant");
  if (!appPassword) throw new Error("APP_DB_PASSWORD manquant");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      process.stdout.write(`→ ${file} … `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log("ok");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'amklabo_app'");
    const pw = client.escapeLiteral(appPassword);
    if (exists.rowCount === 0) {
      await client.query(`CREATE ROLE amklabo_app LOGIN PASSWORD ${pw} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    } else {
      await client.query(`ALTER ROLE amklabo_app PASSWORD ${pw}`);
    }
    await client.query(fs.readFileSync(path.join(process.cwd(), "db", "grants.sql"), "utf8"));
    console.log("Migrations à jour, droits appliqués.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
