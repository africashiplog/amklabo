import { execSync } from "node:child_process";
import { config } from "dotenv";
import { Client } from "pg";

/** Réinitialise la base de test, applique les migrations et les données initiales. */
export default async function setup() {
  const env = config().parsed ?? {};
  const toTest = (url = "") => url.replace(/\/([^/?]+)(\?|$)/, "/amklabo_test$2");
  const owner = toTest(process.env.TEST_DATABASE_OWNER_URL ?? env.DATABASE_OWNER_URL);
  if (!owner.includes("amklabo_test")) throw new Error("Base de test introuvable");

  const client = new Client({ connectionString: owner });
  await client.connect();
  await client.query("DROP OWNED BY amklabo_owner CASCADE");
  await client.end();

  const childEnv = { ...process.env, DATABASE_OWNER_URL: owner, APP_DB_PASSWORD: env.APP_DB_PASSWORD };
  execSync("npx tsx scripts/migrate.ts", { env: childEnv, stdio: "pipe" });
  execSync("npx tsx scripts/seed.ts", { env: childEnv, stdio: "pipe" });
  // Les tests de commande utilisent le paiement à la livraison.
  const c2 = new Client({ connectionString: owner });
  await c2.connect();
  await c2.query("UPDATE payment_methods SET is_active = true WHERE code = 'cash_on_delivery'");
  await c2.end();
}
