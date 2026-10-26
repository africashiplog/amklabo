/**
 * Applique la configuration communiquée par le propriétaire (idempotent) :
 *   npm run config:akmlabo
 *
 *  - raison sociale : AKM Labo (NIF laissé vide tant qu'il n'est pas confirmé) ;
 *  - paiement en espèces à la livraison, et Bankily, Masrivi, Sedad, Bimbank, Click
 *    sur le compte marchand 36608028 (vérification manuelle de chaque paiement) ;
 *  - zone Nouakchott active, frais de livraison fixés manuellement par l'équipe
 *    pour chaque commande (selon la quantité et l'adresse).
 *
 * Tout reste modifiable dans l'administration. Chaque modification est journalisée.
 */
import "dotenv/config";
import { Client } from "pg";

const LEGAL_NAME = "AKM Labo";
const MERCHANT_ACCOUNT = "36608028";
const WALLETS = ["bankily", "masrivi", "sedad", "bimbank", "click"];

const instructions = (name: string) =>
  `Depuis votre application ${name}, envoyez le montant exact indiqué au compte marchand ${MERCHANT_ACCOUNT} (${LEGAL_NAME}). ` +
  "Saisissez ensuite ci-dessous la référence de la transaction affichée par l'application. " +
  "Votre paiement sera vérifié par notre équipe avant confirmation. Ne communiquez jamais votre code PIN.";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const log = (action: string, entity: string, id: string, before: unknown, after: unknown) =>
      client.query(
        "INSERT INTO audit_logs (actor_email, action, entity_type, entity_id, before_data, after_data) VALUES ('cli', $1, $2, $3, $4, $5)",
        [action, entity, id, JSON.stringify(before), JSON.stringify(after)],
      );

    const s = (await client.query("SELECT legal_name, tax_id FROM store_settings WHERE id = 1")).rows[0];
    if (!s) throw new Error("Paramètres absents : lancez d'abord npm run db:seed");
    await client.query("UPDATE store_settings SET legal_name = $1 WHERE id = 1", [LEGAL_NAME]);
    await log("settings.update", "store_settings", "1", s, { legal_name: LEGAL_NAME });

    const cod = (await client.query("SELECT is_active FROM payment_methods WHERE code = 'cash_on_delivery'")).rows[0];
    await client.query("UPDATE payment_methods SET is_active = true WHERE code = 'cash_on_delivery'");
    await log("payment_method.update", "payment_method", "cash_on_delivery", cod, { is_active: true });

    for (const code of WALLETS) {
      const m = (await client.query<{ name: string; is_active: boolean; merchant_account: string | null; instructions: string | null }>(
        "SELECT name, is_active, merchant_account, instructions FROM payment_methods WHERE code = $1", [code],
      )).rows[0];
      if (!m) throw new Error(`Moyen de paiement ${code} absent : lancez d'abord npm run db:migrate`);
      const after = { is_active: true, merchant_account: MERCHANT_ACCOUNT, instructions: m.instructions ?? instructions(m.name) };
      await client.query(
        "UPDATE payment_methods SET is_active = true, merchant_account = $2, instructions = $3, reference_label = 'Référence de la transaction' WHERE code = $1",
        [code, after.merchant_account, after.instructions],
      );
      await log("payment_method.update", "payment_method", code, m, after);
    }

    const z = (await client.query("SELECT id, is_active, fee_mode FROM delivery_zones WHERE name = 'Nouakchott'")).rows[0];
    if (!z) throw new Error("Zone Nouakchott absente : lancez d'abord npm run db:seed");
    await client.query("UPDATE delivery_zones SET is_active = true, fee_mode = 'manual', fee_minor = 0, free_shipping_threshold_minor = NULL WHERE id = $1", [z.id]);
    await log("delivery_zone.update", "delivery_zone", z.id, z, { is_active: true, fee_mode: "manual" });

    await client.query("COMMIT");
    console.log(`Configuration appliquée : ${LEGAL_NAME}, espèces + 5 portefeuilles (compte ${MERCHANT_ACCOUNT}), Nouakchott en frais manuels.`);
    console.log("Restent à saisir dans l'administration : NIF, registre du commerce, coordonnées (téléphone, WhatsApp, e-mail, adresse).");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
