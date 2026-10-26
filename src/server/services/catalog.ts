import { intField, z } from "../validation";
import { slugify } from "@/lib/slug";
import { parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx, type Db } from "../db";
import { ForbiddenError, UserError } from "../errors";
import { can } from "../permissions";
import { deleteStoredFile, saveImage } from "../storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type CategoryWithCount = Category & { product_count: number; child_count: number };

export type ProductSpec = { label: string; value: string };

export type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  brand: string | null;
  manufacturer: string | null;
  specs: ProductSpec[];
  sale_unit: "piece" | "box" | "pack" | "carton" | "lot";
  units_per_sale_unit: number;
  retail_price_minor: number;
  min_order_qty: number;
  stock_alert_threshold: number;
  track_lots: boolean;
  status: "draft" | "published" | "unavailable" | "archived";
  is_featured: boolean;
  created_at: Date;
  updated_at: Date;
  cover_path: string | null;
};

export type ProductImage = { id: string; storage_path: string; alt: string | null; sort_order: number; is_illustration: boolean };

// Statuts visibles sur le site public.
const PUBLIC_STATUSES = "('published','unavailable')";

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
         (SELECT storage_path FROM product_images i WHERE i.product_id = p.id
           ORDER BY sort_order, created_at LIMIT 1) AS cover_path
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id`;

// ---------------------------------------------------------------------------
// Lecture publique
// ---------------------------------------------------------------------------
export async function listPublicCategories(): Promise<CategoryWithCount[]> {
  return query<CategoryWithCount>(
    `SELECT c.*,
            (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.status IN ${PUBLIC_STATUSES}) AS product_count,
            (SELECT count(*)::int FROM categories k WHERE k.parent_id = c.id AND k.is_active) AS child_count
       FROM categories c
      WHERE c.is_active AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM categories pc WHERE pc.id = c.parent_id AND pc.is_active))
      ORDER BY c.sort_order, c.name`,
  );
}

export async function getPublicCategory(slug: string) {
  return queryOne<Category>("SELECT * FROM categories WHERE slug = $1 AND is_active", [slug]);
}

export const SORTS = {
  recent: "p.published_at DESC NULLS LAST, p.created_at DESC",
  name: "p.name ASC",
  price_asc: "p.retail_price_minor ASC, p.name",
  price_desc: "p.retail_price_minor DESC, p.name",
} as const;
export type SortKey = keyof typeof SORTS;

export type ProductSearch = {
  q?: string;
  category?: string; // slug ; inclut les sous-catégories
  brand?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

export async function searchPublicProducts(params: ProductSearch) {
  const pageSize = Math.min(Math.max(params.pageSize ?? 12, 1), 48);
  const page = Math.max(Math.trunc(params.page ?? 1), 1);
  const where: string[] = [`p.status IN ${PUBLIC_STATUSES}`, "(p.category_id IS NULL OR c.is_active)"];
  const args: unknown[] = [];

  const q = params.q?.trim().slice(0, 100);
  if (q) {
    args.push(q);
    const qi = args.length;
    args.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`);
    const li = args.length;
    where.push(`(to_tsvector('french', coalesce(p.name,'') || ' ' || coalesce(p.brand,'') || ' ' || coalesce(p.description,''))
                  @@ plainto_tsquery('french', $${qi})
                 OR p.name ILIKE $${li} OR p.sku ILIKE $${li} OR p.brand ILIKE $${li})`);
  }
  if (params.category) {
    args.push(params.category);
    where.push(`p.category_id IN (SELECT id FROM categories WHERE slug = $${args.length}
                 UNION SELECT k.id FROM categories k JOIN categories pc ON pc.id = k.parent_id WHERE pc.slug = $${args.length})`);
  }
  if (params.brand) {
    args.push(params.brand);
    where.push(`p.brand = $${args.length}`);
  }
  const order = SORTS[params.sort ?? "recent"] ?? SORTS.recent;
  const whereSql = where.join(" AND ");

  const totalRow = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${whereSql}`,
    args,
  );
  const items = await query<ProductRow>(
    `${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  const total = totalRow?.n ?? 0;
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listPublicBrands(): Promise<string[]> {
  const rows = await query<{ brand: string }>(
    `SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand <> '' AND status IN ${PUBLIC_STATUSES} ORDER BY brand`,
  );
  return rows.map((r) => r.brand);
}

export async function getPublicProduct(slug: string) {
  const product = await queryOne<ProductRow>(
    `${PRODUCT_SELECT} WHERE p.slug = $1 AND p.status IN ${PUBLIC_STATUSES} AND (p.category_id IS NULL OR c.is_active)`,
    [slug],
  );
  if (!product) return null;
  const images = await listProductImages(product.id);
  return { product, images };
}

export async function listFeaturedProducts(limit = 8) {
  return query<ProductRow>(
    `${PRODUCT_SELECT} WHERE p.status = 'published' AND p.is_featured AND (p.category_id IS NULL OR c.is_active)
      ORDER BY p.updated_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listNewestProducts(limit = 8) {
  return query<ProductRow>(
    `${PRODUCT_SELECT} WHERE p.status = 'published' AND (p.category_id IS NULL OR c.is_active)
      ORDER BY p.published_at DESC NULLS LAST LIMIT $1`,
    [limit],
  );
}

export async function listProductImages(productId: string, db?: Db) {
  return query<ProductImage>(
    "SELECT id, storage_path, alt, sort_order, is_illustration FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at",
    [productId],
    db,
  );
}

// ---------------------------------------------------------------------------
// Administration : catégories
// ---------------------------------------------------------------------------
export const categorySchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  parentId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

export async function adminListCategories(actor: Actor | null): Promise<CategoryWithCount[]> {
  assertCan(actor, "catalog.manage");
  return query<CategoryWithCount>(
    `SELECT c.*,
            (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count,
            (SELECT count(*)::int FROM categories k WHERE k.parent_id = c.id) AS child_count
       FROM categories c
      ORDER BY c.sort_order, c.name`,
  );
}

async function uniqueSlug(table: "categories" | "products", base: string, excludeId: string | null, db: Db) {
  let slug = base;
  for (let i = 2; ; i++) {
    const exists = await queryOne(
      `SELECT 1 FROM ${table} WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [slug, excludeId],
      db,
    );
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
}

async function assertValidParent(id: string | null, parentId: string | null, db: Db) {
  if (!parentId) return;
  if (parentId === id) throw new UserError("Une catégorie ne peut pas être son propre parent.");
  const parent = await queryOne<{ parent_id: string | null }>("SELECT parent_id FROM categories WHERE id = $1", [parentId], db);
  if (!parent) throw new UserError("Catégorie parente introuvable.");
  // Deux niveaux maximum : catégorie → sous-catégorie.
  if (parent.parent_id) throw new UserError("Une sous-catégorie ne peut pas contenir d'autres sous-catégories.");
  if (id) {
    const hasChildren = await queryOne("SELECT 1 FROM categories WHERE parent_id = $1", [id], db);
    if (hasChildren) throw new UserError("Cette catégorie contient des sous-catégories : elle ne peut pas devenir une sous-catégorie.");
  }
}

export async function createCategory(actor: Actor | null, input: z.input<typeof categorySchema>) {
  assertCan(actor, "catalog.manage");
  const data = categorySchema.parse(input);
  return tx(async (db) => {
    await assertValidParent(null, data.parentId, db);
    const slug = await uniqueSlug("categories", slugify(data.name), null, db);
    const row = await queryOne<Category>(
      `INSERT INTO categories (name, slug, description, parent_id, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, coalesce((SELECT max(sort_order) + 1 FROM categories), 0))
       RETURNING *`,
      [data.name, slug, data.description, data.parentId, data.isActive],
      db,
    );
    await audit(actor, "category.create", "category", row!.id, { after: row }, db);
    return row!;
  });
}

export async function updateCategory(actor: Actor | null, id: string, input: z.input<typeof categorySchema>) {
  assertCan(actor, "catalog.manage");
  const data = categorySchema.parse(input);
  return tx(async (db) => {
    const before = await queryOne<Category>("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id], db);
    if (!before) throw new UserError("Catégorie introuvable.");
    await assertValidParent(id, data.parentId, db);
    const slug = before.name === data.name ? before.slug : await uniqueSlug("categories", slugify(data.name), id, db);
    const after = await queryOne<Category>(
      `UPDATE categories SET name = $2, slug = $3, description = $4, parent_id = $5, is_active = $6
        WHERE id = $1 RETURNING *`,
      [id, data.name, slug, data.description, data.parentId, data.isActive],
      db,
    );
    await audit(actor, "category.update", "category", id, { before, after }, db);
    return after!;
  });
}

/** Déplace une catégorie d'un cran vers le haut ou le bas parmi ses sœurs. */
export async function moveCategory(actor: Actor | null, id: string, direction: "up" | "down") {
  assertCan(actor, "catalog.manage");
  await tx(async (db) => {
    const cur = await queryOne<Category>("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id], db);
    if (!cur) throw new UserError("Catégorie introuvable.");
    const siblings = await query<Category>(
      "SELECT * FROM categories WHERE parent_id IS NOT DISTINCT FROM $1 ORDER BY sort_order, name FOR UPDATE",
      [cur.parent_id],
      db,
    );
    const idx = siblings.findIndex((s) => s.id === id);
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= siblings.length) return;
    [siblings[idx], siblings[swap]] = [siblings[swap], siblings[idx]];
    for (let i = 0; i < siblings.length; i++) {
      await db.query("UPDATE categories SET sort_order = $2 WHERE id = $1", [siblings[i].id, i]);
    }
    await audit(actor, "category.reorder", "category", id, { after: { direction } }, db);
  });
}

export async function deleteCategory(actor: Actor | null, id: string) {
  assertCan(actor, "catalog.manage");
  await tx(async (db) => {
    const before = await queryOne<Category>("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id], db);
    if (!before) throw new UserError("Catégorie introuvable.");
    const usage = await queryOne<{ products: number; children: number }>(
      `SELECT (SELECT count(*)::int FROM products WHERE category_id = $1) AS products,
              (SELECT count(*)::int FROM categories WHERE parent_id = $1) AS children`,
      [id],
      db,
    );
    if (usage!.products > 0 || usage!.children > 0) {
      throw new UserError(
        `Suppression impossible : la catégorie contient ${usage!.products} produit(s) et ${usage!.children} sous-catégorie(s). Désactivez-la ou déplacez son contenu.`,
      );
    }
    try {
      await db.query("DELETE FROM categories WHERE id = $1", [id]);
    } catch (err) {
      if (pgCode(err) === "23503") throw new UserError("Suppression impossible : la catégorie est encore utilisée.");
      throw err;
    }
    await audit(actor, "category.delete", "category", id, { before }, db);
  });
}

// ---------------------------------------------------------------------------
// Administration : produits
// ---------------------------------------------------------------------------
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Nom trop court").max(200),
    sku: z
      .string()
      .trim()
      .min(2, "Référence trop courte")
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "Lettres, chiffres, « . », « _ », « - » ou « / » uniquement"),
    barcode: z
      .string()
      .trim()
      .max(32)
      .regex(/^[0-9A-Za-z\-]*$/, "Code-barres invalide")
      .optional()
      .transform((v) => (v ? v : null)),
    description: optionalText(10000),
    categoryId: z.string().uuid().nullable(),
    brand: optionalText(120),
    manufacturer: optionalText(120),
    saleUnit: z.enum(["piece", "box", "pack", "carton", "lot"]),
    unitsPerSaleUnit: intField(1, 100000),
    retailPrice: z.string().transform((v, ctx) => {
      const minor = parseMRU(v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Prix invalide (ex. 1250 ou 1250,50)" });
        return z.NEVER;
      }
      return minor;
    }),
    minOrderQty: intField(1, 1000000),
    stockAlertThreshold: intField(0, 1000000),
    trackLots: z.boolean(),
    isFeatured: z.boolean(),
    status: z.enum(["draft", "published", "unavailable", "archived"]),
    specs: z
      .array(z.object({ label: z.string().trim().max(80), value: z.string().trim().max(300) }))
      .max(40)
      .transform((rows) => rows.filter((r) => r.label && r.value)),
  })
  .superRefine((p, ctx) => {
    if (p.status === "published" && p.retailPrice <= 0) {
      ctx.addIssue({ code: "custom", path: ["retailPrice"], message: "Un produit publié doit avoir un prix supérieur à zéro" });
    }
    if (p.status === "published" && !p.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Un produit publié doit appartenir à une catégorie" });
    }
  });

export type ProductInput = z.input<typeof productSchema>;

export type AdminProductFilter = { q?: string; status?: string; categoryId?: string; page?: number };

export async function adminListProducts(actor: Actor | null, f: AdminProductFilter) {
  assertCan(actor, "catalog.manage");
  const pageSize = 20;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const where: string[] = ["true"];
  const args: unknown[] = [];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length} OR p.barcode ILIKE $${args.length})`);
  }
  if (f.status && ["draft", "published", "unavailable", "archived"].includes(f.status)) {
    args.push(f.status);
    where.push(`p.status = $${args.length}`);
  }
  if (f.categoryId && /^[0-9a-f-]{36}$/.test(f.categoryId)) {
    args.push(f.categoryId);
    where.push(`p.category_id = $${args.length}`);
  }
  const whereSql = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM products p WHERE ${whereSql}`, args))!.n;
  const items = await query<ProductRow>(
    `${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY p.updated_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function adminGetProduct(actor: Actor | null, id: string) {
  assertCan(actor, "catalog.manage");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const product = await queryOne<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  if (!product) return null;
  return { product, images: await listProductImages(id) };
}

function productParams(d: z.output<typeof productSchema>) {
  return [
    d.name, d.sku, d.barcode, d.description, d.categoryId, d.brand, d.manufacturer,
    JSON.stringify(d.specs), d.saleUnit, d.unitsPerSaleUnit, d.retailPrice, d.minOrderQty,
    d.stockAlertThreshold, d.trackLots, d.status, d.isFeatured,
  ];
}

function mapProductError(err: unknown): never {
  if (pgCode(err) === "23505") {
    throw new UserError("Cette référence SKU est déjà utilisée par un autre produit.", { sku: "Référence déjà utilisée" });
  }
  if (pgCode(err) === "23503") throw new UserError("Catégorie introuvable.", { categoryId: "Catégorie introuvable" });
  throw err;
}

export async function createProduct(actor: Actor | null, input: ProductInput) {
  assertCan(actor, "catalog.manage");
  if (!can(actor.roles, "pricing.manage")) {
    // Sans droit de tarification : le produit est créé sans prix, en brouillon.
    if (input.status !== "draft") {
      throw new UserError("Le prix doit être fixé par un administrateur avant publication : enregistrez le produit en brouillon.");
    }
    input = { ...input, retailPrice: "0" };
  }
  const d = productSchema.parse(input);
  try {
    return await tx(async (db) => {
      const slug = await uniqueSlug("products", slugify(d.name), null, db);
      const row = await queryOne<{ id: string }>(
        `INSERT INTO products (name, sku, barcode, description, category_id, brand, manufacturer, specs, sale_unit,
                               units_per_sale_unit, retail_price_minor, min_order_qty, stock_alert_threshold,
                               track_lots, status, is_featured, slug, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::product_status,$16,$17,
                 CASE WHEN $15::product_status = 'published' THEN now() END)
         RETURNING id`,
        [...productParams(d), slug],
        db,
      );
      await audit(actor, "product.create", "product", row!.id, { after: { ...d, slug } }, db);
      return row!;
    });
  } catch (err) {
    mapProductError(err);
  }
}

export async function updateProduct(actor: Actor | null, id: string, input: ProductInput) {
  assertCan(actor, "catalog.manage");
  const d = productSchema.parse(input);
  try {
    return await tx(async (db) => {
      const before = await queryOne<ProductRow>("SELECT * FROM products WHERE id = $1 FOR UPDATE", [id], db);
      if (!before) throw new UserError("Produit introuvable.");
      if (before.retail_price_minor !== d.retailPrice && !can(actor.roles, "pricing.manage")) {
        throw new ForbiddenError("Seul un administrateur peut modifier le prix de vente.");
      }
      const slug = before.name === d.name ? before.slug : await uniqueSlug("products", slugify(d.name), id, db);
      await db.query(
        `UPDATE products SET name=$1, sku=$2, barcode=$3, description=$4, category_id=$5, brand=$6, manufacturer=$7,
                specs=$8, sale_unit=$9, units_per_sale_unit=$10, retail_price_minor=$11, min_order_qty=$12,
                stock_alert_threshold=$13, track_lots=$14, status=$15::product_status, is_featured=$16, slug=$17,
                published_at = CASE WHEN $15::product_status = 'published' THEN coalesce(published_at, now()) ELSE published_at END
          WHERE id = $18`,
        [...productParams(d), slug, id],
      );
      await audit(actor, "product.update", "product", id, { before, after: { ...d, slug } }, db);
      // Les changements de prix sont tracés séparément pour faciliter le contrôle.
      if (before.retail_price_minor !== d.retailPrice) {
        await audit(actor, "product.price_change", "product", id, {
          before: { retail_price_minor: before.retail_price_minor },
          after: { retail_price_minor: d.retailPrice },
        }, db);
      }
      if (before.status !== d.status) {
        await audit(actor, "product.status_change", "product", id, {
          before: { status: before.status }, after: { status: d.status },
        }, db);
      }
      return { id, slug };
    });
  } catch (err) {
    mapProductError(err);
  }
}

/**
 * Suppression définitive : réservée aux produits brouillons ou archivés.
 * Les futures lignes de commande et de facture référenceront les produits
 * avec ON DELETE RESTRICT, ce qui bloquera la suppression au niveau de la base.
 */
export async function deleteProduct(actor: Actor | null, id: string) {
  assertCan(actor, "catalog.manage");
  const paths = await tx(async (db) => {
    const before = await queryOne<ProductRow>("SELECT * FROM products WHERE id = $1 FOR UPDATE", [id], db);
    if (!before) throw new UserError("Produit introuvable.");
    if (!["draft", "archived"].includes(before.status)) {
      throw new UserError("Archivez d'abord le produit avant de le supprimer définitivement.");
    }
    const images = await listProductImages(id, db);
    try {
      await db.query("DELETE FROM products WHERE id = $1", [id]);
    } catch (err) {
      if (pgCode(err) === "23503") throw new UserError("Ce produit est lié à un historique : archivez-le au lieu de le supprimer.");
      throw err;
    }
    await audit(actor, "product.delete", "product", id, { before }, db);
    return images.map((i) => i.storage_path);
  });
  await Promise.all(paths.map(deleteStoredFile));
}

export const MAX_IMAGES_PER_PRODUCT = 10;

export async function addProductImage(actor: Actor | null, productId: string, file: File, alt: string | null) {
  assertCan(actor, "catalog.manage");
  const product = await queryOne<{ id: string; name: string }>("SELECT id, name FROM products WHERE id = $1", [productId]);
  if (!product) throw new UserError("Produit introuvable.");
  const count = (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM product_images WHERE product_id = $1", [productId]))!.n;
  if (count >= MAX_IMAGES_PER_PRODUCT) throw new UserError(`Maximum ${MAX_IMAGES_PER_PRODUCT} images par produit.`);
  const storagePath = await saveImage(file, "products");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO product_images (product_id, storage_path, alt, sort_order)
     VALUES ($1, $2, $3, coalesce((SELECT max(sort_order) + 1 FROM product_images WHERE product_id = $1), 0))
     RETURNING id`,
    [productId, storagePath, alt?.slice(0, 200) || product.name],
  );
  await audit(actor, "product.image_add", "product", productId, { after: { imageId: row!.id, storagePath } });
  return row!;
}

export async function deleteProductImage(actor: Actor | null, imageId: string) {
  assertCan(actor, "catalog.manage");
  const img = await queryOne<{ product_id: string; storage_path: string }>(
    "DELETE FROM product_images WHERE id = $1 RETURNING product_id, storage_path",
    [imageId],
  );
  if (!img) throw new UserError("Image introuvable.");
  await deleteStoredFile(img.storage_path);
  await audit(actor, "product.image_delete", "product", img.product_id, { before: img });
}

/** Place l'image en première position (image principale). */
export async function makeCoverImage(actor: Actor | null, imageId: string) {
  assertCan(actor, "catalog.manage");
  await tx(async (db) => {
    const img = await queryOne<{ product_id: string }>("SELECT product_id FROM product_images WHERE id = $1", [imageId], db);
    if (!img) throw new UserError("Image introuvable.");
    const all = await listProductImages(img.product_id, db);
    const ordered = [imageId, ...all.map((i) => i.id).filter((i) => i !== imageId)];
    for (let i = 0; i < ordered.length; i++) {
      await db.query("UPDATE product_images SET sort_order = $2 WHERE id = $1", [ordered[i], i]);
    }
  });
}

/** Liste compacte des produits pour les formulaires d'administration. */
export async function listProductOptions(actor: Actor | null) {
  assertCan(actor, "admin.access");
  return query<{ id: string; name: string; sku: string; status: string }>(
    "SELECT id, name, sku, status FROM products WHERE status <> 'archived' ORDER BY name",
  );
}
