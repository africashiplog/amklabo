/**
 * Moteur de tarification — seule source de vérité des prix.
 *
 * Règles de priorité (sans cumul) :
 *   1. Prix négocié du client professionnel approuvé (valide à la date et pour
 *      la quantité) : il s'applique tel quel, aucune autre règle n'est appliquée.
 *   2. Sinon, le client paie le MEILLEUR prix unitaire parmi :
 *        a. le prix public de détail ;
 *        b. les paliers de quantité auxquels il a droit (« tous » ou, pour un
 *           professionnel approuvé, « professionnels ») ;
 *        c. les promotions actives qui le concernent, appliquées au prix de détail.
 *      Les remises ne se cumulent jamais entre elles.
 *
 * Arrondi : les remises en pourcentage sont arrondies au centime (unité mineure)
 * le plus proche, demi-centime arrondi au supérieur. Calculs en entiers uniquement.
 * Les prix envoyés par le navigateur ne sont jamais utilisés.
 */
import { parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx, type Db } from "../db";
import { UserError } from "../errors";
import { z } from "../validation";

export type PriceContext = { customerId: string | null; isBusiness: boolean };

export const ANONYMOUS: PriceContext = { customerId: null, isBusiness: false };

/** Droit aux tarifs professionnels : compte pro approuvé ET client actif. */
export async function getPriceContext(actor: Actor | null, db?: Db): Promise<PriceContext> {
  if (!actor) return ANONYMOUS;
  const row = await queryOne<{ id: string; business: boolean }>(
    `SELECT c.id, (b.status = 'approved' AND c.status = 'active') IS TRUE AS business
       FROM customers c LEFT JOIN business_accounts b ON b.customer_id = c.id
      WHERE c.user_id = $1`,
    [actor.id],
    db,
  );
  return row ? { customerId: row.id, isBusiness: row.business } : ANONYMOUS;
}

export type PriceSource = "retail" | "tier" | "business_tier" | "promotion" | "customer";

export type PriceQuote = {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  retailUnitPriceMinor: number;
  source: PriceSource;
  label: string;
  minOrderQty: number;
};

type ProductPricing = { id: string; retail_price_minor: number; min_order_qty: number; category_id: string | null };

const today = (at: Date) => at.toISOString().slice(0, 10); // Africa/Nouakchott = UTC

/** Applique une remise sur un prix unitaire (entiers uniquement). */
export function applyDiscount(priceMinor: number, type: "percent" | "amount", value: number): number {
  if (type === "amount") return Math.max(priceMinor - value, 0);
  // value en centièmes de pourcent (1000 = 10 %), arrondi demi au supérieur.
  const discount = (BigInt(priceMinor) * BigInt(value) + 5000n) / 10000n;
  return Math.max(priceMinor - Number(discount), 0);
}

async function loadProducts(ids: string[], db?: Db) {
  const rows = await query<ProductPricing>(
    "SELECT id, retail_price_minor, min_order_qty, category_id FROM products WHERE id = ANY($1::uuid[])",
    [ids],
    db,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Calcule le prix d'un ensemble de lignes en une passe.
 * Lève une erreur si une quantité est invalide ou si un produit est introuvable.
 */
export async function quoteLines(
  ctx: PriceContext,
  lines: { productId: string; quantity: number }[],
  at: Date = new Date(),
  db?: Db,
): Promise<PriceQuote[]> {
  if (lines.length === 0) return [];
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1_000_000) {
      throw new UserError("Quantité invalide.");
    }
  }
  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await loadProducts(ids, db);
  const day = today(at);
  const audiences = ctx.isBusiness ? ["all", "business"] : ["all"];

  const tiers = await query<{ product_id: string; audience: string; min_qty: number; unit_price_minor: number }>(
    `SELECT product_id, audience, min_qty, unit_price_minor FROM price_tiers
      WHERE product_id = ANY($1::uuid[]) AND audience = ANY($2::price_audience[])
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [ids, audiences, day],
    db,
  );
  const promoAudiences = ctx.isBusiness ? ["all", "business"] : ["all", "retail"];
  const promos = await query<{ product_id: string | null; category_id: string | null; name: string; discount_type: "percent" | "amount"; discount_value: number }>(
    `SELECT p.product_id, p.category_id, p.name, p.discount_type, p.discount_value FROM promotions p
      WHERE p.is_active AND p.starts_at <= $1 AND p.ends_at > $1 AND p.audience = ANY($2::price_audience[])
        AND (p.product_id = ANY($3::uuid[])
             OR p.category_id IN (SELECT category_id FROM products WHERE id = ANY($3::uuid[]))
             OR p.category_id IN (SELECT c.parent_id FROM categories c JOIN products pr ON pr.category_id = c.id
                                   WHERE pr.id = ANY($3::uuid[]) AND c.parent_id IS NOT NULL))`,
    [at, promoAudiences, ids],
    db,
  );
  const parents = new Map(
    (await query<{ id: string; parent_id: string | null }>("SELECT id, parent_id FROM categories", [], db)).map((c) => [c.id, c.parent_id]),
  );
  const customerPrices = ctx.isBusiness && ctx.customerId
    ? await query<{ product_id: string; min_qty: number; unit_price_minor: number }>(
        `SELECT product_id, min_qty, unit_price_minor FROM customer_prices
          WHERE customer_id = $1 AND product_id = ANY($2::uuid[])
            AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
        [ctx.customerId, ids, day],
        db,
      )
    : [];

  return lines.map(({ productId, quantity }) => {
    const p = products.get(productId);
    if (!p) throw new UserError("Produit introuvable.");
    const base = { productId, quantity, retailUnitPriceMinor: p.retail_price_minor, minOrderQty: p.min_order_qty };
    const done = (unit: number, source: PriceSource, label: string): PriceQuote => ({
      ...base, unitPriceMinor: unit, lineTotalMinor: unit * quantity, source, label,
    });

    // 1. Prix négocié : priorité absolue.
    const negotiated = customerPrices
      .filter((c) => c.product_id === productId && c.min_qty <= quantity)
      .sort((a, b) => a.unit_price_minor - b.unit_price_minor)[0];
    if (negotiated) return done(negotiated.unit_price_minor, "customer", "Prix négocié");

    // 2. Meilleur prix parmi détail, paliers et promotions.
    let best = done(p.retail_price_minor, "retail", "Prix public");
    for (const t of tiers) {
      if (t.product_id === productId && t.min_qty <= quantity && t.unit_price_minor < best.unitPriceMinor) {
        best = done(t.unit_price_minor, t.audience === "business" ? "business_tier" : "tier",
          `${t.audience === "business" ? "Tarif professionnel" : "Tarif quantité"} dès ${t.min_qty}`);
      }
    }
    const productCats = new Set([p.category_id, p.category_id ? parents.get(p.category_id) : null].filter(Boolean));
    for (const pr of promos) {
      const applies = pr.product_id === productId || (pr.category_id !== null && productCats.has(pr.category_id));
      if (!applies) continue;
      const price = applyDiscount(p.retail_price_minor, pr.discount_type, pr.discount_value);
      if (price < best.unitPriceMinor) best = done(price, "promotion", pr.name);
    }
    return best;
  });
}

export async function quote(ctx: PriceContext, productId: string, quantity: number, at = new Date(), db?: Db) {
  return (await quoteLines(ctx, [{ productId, quantity }], at, db))[0];
}

export type VisibleTier = { min_qty: number; unit_price_minor: number; kind: "tier" | "business_tier" | "customer" };

/** Paliers affichables pour ce client (jamais les tarifs pros à un non-approuvé). */
export async function listVisibleTiers(ctx: PriceContext, productId: string, at = new Date()): Promise<VisibleTier[]> {
  const day = today(at);
  const rows = await query<VisibleTier>(
    `SELECT min_qty, unit_price_minor, CASE audience WHEN 'business' THEN 'business_tier' ELSE 'tier' END AS kind
       FROM price_tiers
      WHERE product_id = $1 AND audience = ANY($2::price_audience[])
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)
     UNION ALL
     SELECT min_qty, unit_price_minor, 'customer' FROM customer_prices
      WHERE $4::boolean AND customer_id = $5 AND product_id = $1
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY min_qty, unit_price_minor`,
    [productId, ctx.isBusiness ? ["all", "business"] : ["all"], day, ctx.isBusiness, ctx.customerId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
const money = z.string().transform((v, ctx) => {
  const m = parseMRU(v);
  if (m === null || m <= 0) {
    ctx.addIssue({ code: "custom", message: "Montant invalide (supérieur à zéro)" });
    return z.NEVER;
  }
  return m;
});
const optDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date invalide");

const qty = z.union([z.number(), z.string().trim()]).pipe(z.coerce.number().int("Nombre entier attendu").min(1).max(1_000_000));

export const tierSchema = z
  .object({ audience: z.enum(["all", "business"]), minQty: qty, unitPrice: money, validFrom: optDate, validTo: optDate })
  .refine((d) => !d.validFrom || !d.validTo || d.validTo >= d.validFrom, { message: "La date de fin précède la date de début", path: ["validTo"] });

export type TierRow = { id: string; audience: "all" | "business"; min_qty: number; unit_price_minor: number; valid_from: string | null; valid_to: string | null };

export async function adminListTiers(actor: Actor | null, productId: string) {
  assertCan(actor, "catalog.manage");
  return query<TierRow>(
    "SELECT id, audience, min_qty, unit_price_minor, valid_from, valid_to FROM price_tiers WHERE product_id = $1 ORDER BY audience, min_qty",
    [productId],
  );
}

export async function addTier(actor: Actor | null, productId: string, input: z.input<typeof tierSchema>) {
  assertCan(actor, "pricing.manage");
  const d = tierSchema.parse(input);
  await tx(async (db) => {
    const p = await queryOne<{ retail_price_minor: number; min_order_qty: number }>(
      "SELECT retail_price_minor, min_order_qty FROM products WHERE id = $1 FOR UPDATE", [productId], db,
    );
    if (!p) throw new UserError("Produit introuvable.");
    if (d.minQty < 2) throw new UserError("Un palier commence à partir de 2 unités au moins.", { minQty: "Minimum 2" });
    if (d.unitPrice >= p.retail_price_minor) {
      throw new UserError("Le prix du palier doit être inférieur au prix public.", { unitPrice: "Doit être inférieur au prix public" });
    }
    const dup = await queryOne(
      `SELECT 1 FROM price_tiers WHERE product_id = $1 AND audience = $2 AND min_qty = $3
          AND daterange(valid_from, valid_to, '[]') && daterange($4::date, $5::date, '[]')`,
      [productId, d.audience, d.minQty, d.validFrom, d.validTo], db,
    );
    if (dup) throw new UserError("Un palier existe déjà pour cette quantité sur la même période.", { minQty: "Palier déjà défini" });
    const row = await queryOne<{ id: string }>(
      `INSERT INTO price_tiers (product_id, audience, min_qty, unit_price_minor, valid_from, valid_to)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [productId, d.audience, d.minQty, d.unitPrice, d.validFrom, d.validTo], db,
    );
    await audit(actor, "pricing.tier_add", "product", productId, { after: { tierId: row!.id, ...d } }, db);
  });
}

export async function deleteTier(actor: Actor | null, tierId: string) {
  assertCan(actor, "pricing.manage");
  const before = await queryOne<TierRow & { product_id: string }>("DELETE FROM price_tiers WHERE id = $1 RETURNING *", [tierId]);
  if (!before) throw new UserError("Palier introuvable.");
  await audit(actor, "pricing.tier_delete", "product", before.product_id, { before });
}

export const customerPriceSchema = z
  .object({ productId: z.string().uuid("Produit requis"), minQty: qty, unitPrice: money, validFrom: optDate, validTo: optDate,
    note: z.string().trim().max(300).optional().transform((v) => v || null) })
  .refine((d) => !d.validFrom || !d.validTo || d.validTo >= d.validFrom, { message: "La date de fin précède la date de début", path: ["validTo"] });

export async function setCustomerPrice(actor: Actor | null, customerId: string, input: z.input<typeof customerPriceSchema>) {
  assertCan(actor, "pricing.manage");
  const d = customerPriceSchema.parse(input);
  await tx(async (db) => {
    const c = await queryOne<{ customer_type: string }>("SELECT customer_type FROM customers WHERE id = $1", [customerId], db);
    if (!c) throw new UserError("Client introuvable.");
    if (c.customer_type !== "business") throw new UserError("Les prix négociés sont réservés aux clients professionnels.");
    const product = await queryOne("SELECT 1 FROM products WHERE id = $1", [d.productId], db);
    if (!product) throw new UserError("Produit introuvable.", { productId: "Introuvable" });
    const before = await queryOne(
      "SELECT * FROM customer_prices WHERE customer_id = $1 AND product_id = $2 AND min_qty = $3 FOR UPDATE",
      [customerId, d.productId, d.minQty], db,
    );
    const after = await queryOne(
      `INSERT INTO customer_prices (customer_id, product_id, min_qty, unit_price_minor, valid_from, valid_to, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (customer_id, product_id, min_qty) DO UPDATE SET unit_price_minor = EXCLUDED.unit_price_minor,
         valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, note = EXCLUDED.note, created_by = EXCLUDED.created_by
       RETURNING *`,
      [customerId, d.productId, d.minQty, d.unitPrice, d.validFrom, d.validTo, d.note, actor.id], db,
    );
    await audit(actor, "pricing.customer_price_set", "customer", customerId, { before, after }, db);
  });
}

export async function deleteCustomerPrice(actor: Actor | null, id: string) {
  assertCan(actor, "pricing.manage");
  const before = await queryOne<{ customer_id: string }>("DELETE FROM customer_prices WHERE id = $1 RETURNING *", [id]);
  if (!before) throw new UserError("Prix introuvable.");
  await audit(actor, "pricing.customer_price_delete", "customer", before.customer_id, { before });
}

export type CustomerPriceRow = {
  id: string; product_id: string; product_name: string; sku: string; min_qty: number; unit_price_minor: number;
  retail_price_minor: number; valid_from: string | null; valid_to: string | null; note: string | null;
};

export async function listCustomerPrices(actor: Actor | null, customerId: string) {
  assertCan(actor, "customers.read");
  return query<CustomerPriceRow>(
    `SELECT cp.id, cp.product_id, p.name AS product_name, p.sku, cp.min_qty, cp.unit_price_minor, p.retail_price_minor,
            cp.valid_from, cp.valid_to, cp.note
       FROM customer_prices cp JOIN products p ON p.id = cp.product_id
      WHERE cp.customer_id = $1 ORDER BY p.name, cp.min_qty`,
    [customerId],
  );
}

// --- Promotions ---------------------------------------------------------------
export const promotionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    target: z.enum(["product", "category"]),
    productId: z.string().uuid().nullable(),
    categoryId: z.string().uuid().nullable(),
    audience: z.enum(["all", "retail", "business"]),
    discountType: z.enum(["percent", "amount"]),
    discountValue: z.string().trim(),
    startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
    endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
    isActive: z.boolean(),
  })
  .transform((d, ctx) => {
    let value: number | null;
    if (d.discountType === "percent") {
      // Pourcentage saisi (ex. « 12,5 ») → centièmes de pourcent.
      value = parseMRU(d.discountValue);
      if (value !== null && (value <= 0 || value > 9000)) value = null;
      if (value === null) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Pourcentage entre 0,01 et 90" });
    } else {
      value = parseMRU(d.discountValue);
      if (value === null || value <= 0) {
        value = null;
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Montant invalide" });
      }
    }
    if (d.target === "product" && !d.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Produit requis" });
    if (d.target === "category" && !d.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Catégorie requise" });
    if (d.endsAt < d.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La date de fin précède la date de début" });
    return {
      ...d,
      value: value ?? 0,
      productId: d.target === "product" ? d.productId : null,
      categoryId: d.target === "category" ? d.categoryId : null,
      // Promotion valable du début du jour de début à la fin du jour de fin (heure de Nouakchott = UTC).
      startsAtTs: `${d.startsAt}T00:00:00Z`,
      endsAtTs: new Date(Date.parse(`${d.endsAt}T00:00:00Z`) + 86_400_000).toISOString(),
    };
  });

export type PromotionRow = {
  id: string; name: string; product_id: string | null; product_name: string | null; category_id: string | null;
  category_name: string | null; audience: "all" | "retail" | "business"; discount_type: "percent" | "amount";
  discount_value: number; starts_at: Date; ends_at: Date; is_active: boolean;
};

export async function adminListPromotions(actor: Actor | null) {
  assertCan(actor, "pricing.manage");
  return query<PromotionRow>(
    `SELECT pr.*, p.name AS product_name, c.name AS category_name FROM promotions pr
       LEFT JOIN products p ON p.id = pr.product_id LEFT JOIN categories c ON c.id = pr.category_id
      ORDER BY pr.is_active DESC, pr.ends_at DESC`,
  );
}

export async function savePromotion(actor: Actor | null, id: string | null, input: z.input<typeof promotionSchema>) {
  assertCan(actor, "pricing.manage");
  const d = promotionSchema.parse(input);
  await tx(async (db) => {
    const params = [d.name, d.productId, d.categoryId, d.audience, d.discountType, d.value, d.startsAtTs, d.endsAtTs, d.isActive];
    if (id) {
      const before = await queryOne("SELECT * FROM promotions WHERE id = $1 FOR UPDATE", [id], db);
      if (!before) throw new UserError("Promotion introuvable.");
      const after = await queryOne(
        `UPDATE promotions SET name=$1, product_id=$2, category_id=$3, audience=$4, discount_type=$5, discount_value=$6,
                starts_at=$7, ends_at=$8, is_active=$9 WHERE id=$10 RETURNING *`,
        [...params, id], db,
      );
      await audit(actor, "pricing.promotion_update", "promotion", id, { before, after }, db);
    } else {
      const after = await queryOne<{ id: string }>(
        `INSERT INTO promotions (name, product_id, category_id, audience, discount_type, discount_value, starts_at, ends_at, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [...params, actor.id], db,
      );
      await audit(actor, "pricing.promotion_create", "promotion", after!.id, { after }, db);
    }
  });
}

export async function deletePromotion(actor: Actor | null, id: string) {
  assertCan(actor, "pricing.manage");
  const before = await queryOne("DELETE FROM promotions WHERE id = $1 RETURNING *", [id]);
  if (!before) throw new UserError("Promotion introuvable.");
  await audit(actor, "pricing.promotion_delete", "promotion", id, { before });
}
