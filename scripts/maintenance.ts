/**
 * Maintenance quotidienne (à planifier, ex. cron 03:00) :
 *  - supprime les sessions expirées ;
 *  - supprime les tentatives de connexion de plus de 30 jours ;
 *  - supprime les notifications lues de plus de 180 jours.
 * Ne touche jamais aux données commerciales, financières ni au journal d'audit.
 */
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const s = await client.query("DELETE FROM sessions WHERE expires_at < now()");
    const a = await client.query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
    const n = await client.query("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '180 days'");
    console.log(`Sessions expirées : ${s.rowCount} · tentatives anciennes : ${a.rowCount} · notifications lues anciennes : ${n.rowCount}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
