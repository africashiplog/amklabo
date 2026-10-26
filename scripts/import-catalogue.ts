/**
 * Importe le catalogue de départ en BROUILLONS (idempotent) :
 *   npm run catalogue:import            # produits + images d'illustration
 *   npm run catalogue:import -- --sans-images
 *
 * Chaque produit est un type de produit générique (db/catalogue-brouillon.json) :
 * prix 0, aucune marque, aucune caractéristique, statut « brouillon ». Il ne peut
 * pas être publié avant que AMKLABO ait saisi le prix (contrôle serveur), et doit
 * être complété (marque, conditionnement, caractéristiques vérifiées) puis
 * approvisionné (lots, dates de péremption réelles).
 *
 * Les images (db/catalogue-images.json) sont des illustrations générées, marquées
 * comme telles sur le site ; à remplacer par de vraies photos des produits vendus.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { slugify } from "../src/lib/slug";
import { detectImageType } from "../src/server/storage";

type Item = { sku: string; name: string; category: string; unit: "piece" | "box" | "pack" };

const MAX_BYTES = 8 * 1024 * 1024;

async function download(url: string): Promise<{ buf: Buffer; type: "png" | "jpg" | "webp" }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("image trop volumineuse");
  const type = detectImageType(buf);
  if (!type) throw new Error("format d'image non reconnu");
  return { buf, type };
}

async function main() {
  const { values } = parseArgs({ options: { "sans-images": { type: "boolean", default: false } } });
  const root = process.cwd();
  const items: Item[] = JSON.parse(await fs.readFile(path.join(root, "db", "catalogue-brouillon.json"), "utf8"));
  const images: Record<string, string> = JSON.parse(await fs.readFile(path.join(root, "db", "catalogue-images.json"), "utf8")).images;
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");

  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  let created = 0, imaged = 0;
  const failures: string[] = [];
  try {
    const cats = new Map((await client.query<{ id: string; slug: string }>("SELECT id, slug FROM categories")).rows.map((c) => [c.slug, c.id]));
    for (const it of items) {
      const categoryId = cats.get(it.category);
      if (!categoryId) throw new Error(`Catégorie « ${it.category} » absente : lancez d'abord npm run db:seed`);
      let product = (await client.query<{ id: string; has_image: boolean }>(
        "SELECT id, EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) AS has_image FROM products p WHERE sku = $1", [it.sku],
      )).rows[0];
      if (!product) {
        let slug = slugify(it.name);
        if ((await client.query("SELECT 1 FROM products WHERE slug = $1", [slug])).rowCount) slug = `${slug}-${slugify(it.sku)}`;
        const id = (await client.query<{ id: string }>(
          `INSERT INTO products (sku, name, slug, category_id, sale_unit, retail_price_minor, track_lots, status)
           VALUES ($1, $2, $3, $4, $5, 0, true, 'draft') RETURNING id`,
          [it.sku, it.name, slug, categoryId, it.unit],
        )).rows[0].id;
        await client.query(
          "INSERT INTO audit_logs (actor_email, action, entity_type, entity_id, after_data) VALUES ('cli', 'product.import_draft', 'product', $1, $2)",
          [id, { sku: it.sku, name: it.name }],
        );
        product = { id, has_image: false };
        created++;
      }
      if (values["sans-images"] || product.has_image || !images[it.sku]) continue;
      try {
        const { buf, type } = await download(images[it.sku]);
        const rel = `products/${randomUUID()}.${type}`;
        await fs.mkdir(path.join(uploadRoot, "products"), { recursive: true });
        await fs.writeFile(path.join(uploadRoot, rel), buf, { flag: "wx" });
        await client.query(
          "INSERT INTO product_images (product_id, storage_path, alt, sort_order, is_illustration) VALUES ($1, $2, $3, 0, true)",
          [product.id, rel, `${it.name} (image d'illustration)`],
        );
        imaged++;
      } catch (err) {
        failures.push(`${it.sku} : ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`Produits créés en brouillon : ${created} (sur ${items.length}). Images ajoutées : ${imaged}.`);
  if (failures.length) {
    console.log(`Images non téléchargées (${failures.length}) — relancez la commande plus tard :`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
