/**
 * Crée (ou promeut) un compte administrateur.
 *   npm run admin:create -- --email admin@exemple.mr --name "Nom Prénom"
 * Le mot de passe est lu depuis ADMIN_PASSWORD ; à défaut, un mot de passe
 * aléatoire est généré et affiché une seule fois.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { hashPassword } from "../src/server/password";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !name) throw new Error('Usage : npm run admin:create -- --email <email> --name "<nom>"');
  const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString("base64url");
  if (password.length < 10) throw new Error("ADMIN_PASSWORD doit contenir au moins 10 caractères");

  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const hash = await hashPassword(password);
    const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
    let id: string;
    if (existing.rowCount) {
      id = existing.rows[0].id;
      await client.query("UPDATE users SET password_hash = $2, status = 'active' WHERE id = $1", [id, hash]);
    } else {
      id = (await client.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", [email, hash])).rows[0].id;
      await client.query("INSERT INTO profiles (user_id, full_name) VALUES ($1, $2)", [id, name]);
    }
    await client.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [id]);
    await client.query(
      "INSERT INTO audit_logs (actor_email, action, entity_type, entity_id) VALUES ('cli', 'user.create_admin', 'user', $1)",
      [id],
    );
    await client.query("COMMIT");
    console.log(`Administrateur prêt : ${email}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`Mot de passe généré (à changer après connexion) : ${password}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
