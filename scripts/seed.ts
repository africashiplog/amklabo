/**
 * Données initiales indispensables (idempotent) :
 * paramètres du magasin, catégories initiales, zone Nouakchott, pages de contenu.
 * Aucune donnée commerciale fictive n'est créée ici.
 */
import "dotenv/config";
import { Client } from "pg";
import { slugify } from "../src/lib/slug";

const CATEGORIES = [
  "Tubes de prélèvement sanguin",
  "Aiguilles et seringues",
  "Gants et équipements de protection",
  "Pansements, compresses et consommables médicaux",
  "Matériel de prélèvement",
  "Consommables de laboratoire",
  "Équipements médicaux",
  "Appareils de mesure",
  "Produits de désinfection et de stérilisation",
  "Matériel pour cliniques et hôpitaux",
  "Autres produits",
];

const PLACEHOLDER =
  "[Contenu à rédiger par AMKLABO]\n\n" +
  "Ce texte n'a pas encore été rédigé. Il doit être rédigé par AMKLABO et, si nécessaire, " +
  "validé par un conseiller juridique avant la mise en ligne.\n\n" +
  "Modifiable dans Administration → Pages de contenu.";

const PAGES: [string, string][] = [
  ["a-propos", "À propos"],
  ["conditions-generales", "Conditions générales de vente"],
  ["confidentialite", "Politique de confidentialité"],
  ["livraison-retours", "Livraison et retours"],
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO store_settings (id) VALUES (1) ON CONFLICT DO NOTHING");
    for (const [i, name] of CATEGORIES.entries()) {
      await client.query(
        "INSERT INTO categories (name, slug, sort_order) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING",
        [name, slugify(name), i],
      );
    }
    // Zone inactive tant que les frais n'ont pas été définis par AMKLABO.
    await client.query(
      "INSERT INTO delivery_zones (name, city, fee_minor, is_active) VALUES ('Nouakchott', 'Nouakchott', 0, false) ON CONFLICT DO NOTHING",
    );
    for (const [slug, title] of PAGES) {
      await client.query(
        "INSERT INTO content_pages (slug, title, body) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [slug, title, PLACEHOLDER],
      );
    }
    await client.query("COMMIT");
    console.log("Données initiales en place.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
