/**
 * Stock par lots. Toute variation passe par applyMovement() :
 *  - mise à jour atomique du lot (verrou de ligne implicite de l'UPDATE) ;
 *  - contrainte CHECK (qty_on_hand >= 0) : la base refuse tout stock négatif,
 *    y compris en cas d'opérations concurrentes ;
 *  - écriture d'un mouvement immuable avec le solde après opération.
 * Les quantités sont exprimées en unités de vente du produit.
 */
import type { PoolClient } from "pg";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx, type Db } from "../db";
import { UserError } from "../errors";
import { parseMRU } from "@/lib/money";
import { z } from "../validation";

export const MOVEMENT_LABELS = {
  purchase_receipt: "Réception fournisseur",
  manual_in: "Entrée manuelle",
  adjustment_in: "Ajustement (+)",
  adjustment_out: "Ajustement (−)",
  return_in: "Retour client",
  return_to_supplier: "Retour fournisseur",
  loss: "Perte / casse",
  expiry_writeoff: "Mise au rebut (péremption)",
  sale_out: "Vente",
} as const;
export type MovementType = keyof typeof MOVEMENT_LABELS;

const IN_TYPES = ["purchase_receipt", "manual_in", "adjustment_in", "return_in"] as const;
const OUT_TYPES = ["adjustment_out", "return_to_supplier", "loss", "expiry_writeoff", "sale_out"] as const;

/** Applique un mouvement sur un lot dans la transaction fournie. */
export async function applyMovement(
  db: PoolClient,
  actor: Actor | null,
  m: {
    lotId: string; type: MovementType; quantity: number; reason?: string | null; purchaseOrderId?: string | null;
    orderId?: string | null;
    /** Sortie de marchandise réservée (expédition d'une commande) : diminue aussi le réservé. */
    fromReservation?: boolean;
  },
) {
  if (!Number.isInteger(m.quantity) || m.quantity === 0) throw new UserError("Quantité invalide.");
  const isIn = (IN_TYPES as readonly string[]).includes(m.type);
  if (isIn !== m.quantity > 0) throw new Error(`Signe de quantité incohérent pour ${m.type}`);
  let lot: { product_id: string; qty_on_hand: number } | null;
  try {
    lot = await queryOne<{ product_id: string; qty_on_hand: number }>(
      `UPDATE stock_lots SET qty_on_hand = qty_on_hand + $2,
              qty_reserved = qty_reserved + CASE WHEN $3::boolean THEN $2 ELSE 0 END
        WHERE id = $1 RETURNING product_id, qty_on_hand`,
      [m.lotId, m.quantity, m.fromReservation === true], db,
    );
  } catch (err) {
    // Contrainte de base : stock négatif, ou sortie de quantités réservées par des commandes.
    if (pgCode(err) === "23514") throw new UserError("Stock disponible insuffisant dans ce lot (quantités réservées par des commandes incluses) : opération refusée.");
    throw err;
  }
  if (!lot) throw new UserError("Lot introuvable.");
  await db.query(
    `INSERT INTO inventory_movements (product_id, lot_id, movement_type, quantity, balance_after, reason, purchase_order_id, order_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [lot.product_id, m.lotId, m.type, m.quantity, lot.qty_on_hand, m.reason ?? null, m.purchaseOrderId ?? null, m.orderId ?? null, actor?.id ?? null],
  );
  return lot.qty_on_hand;
}

/** Trouve ou crée le lot correspondant (même numéro et même date de péremption). */
export async function findOrCreateLot(
  db: PoolClient,
  l: { productId: string; lotNumber: string | null; expiryDate: string | null; supplierId?: string | null;
       purchaseOrderItemId?: string | null; unitCostMinor?: number | null },
) {
  if (!l.purchaseOrderItemId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM stock_lots WHERE product_id = $1 AND lot_number IS NOT DISTINCT FROM $2
          AND expiry_date IS NOT DISTINCT FROM $3::date AND purchase_order_item_id IS NULL
        ORDER BY created_at LIMIT 1`,
      [l.productId, l.lotNumber, l.expiryDate], db,
    );
    if (existing) return existing.id;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO stock_lots (product_id, lot_number, expiry_date, supplier_id, purchase_order_item_id, unit_cost_minor)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [l.productId, l.lotNumber, l.expiryDate, l.supplierId ?? null, l.purchaseOrderItemId ?? null, l.unitCostMinor ?? null], db,
  );
  return row!.id;
}

/** Vérifie les exigences de traçabilité du produit (lot + péremption si suivi par lots). */
export async function assertLotInfo(db: Db, productId: string, lotNumber: string | null, expiryDate: string | null) {
  const p = await queryOne<{ track_lots: boolean; name: string }>("SELECT track_lots, name FROM products WHERE id = $1", [productId], db);
  if (!p) throw new UserError("Produit introuvable.");
  if (p.track_lots && (!lotNumber || !expiryDate)) {
    throw new UserError(`« ${p.name} » est suivi par lots : numéro de lot et date de péremption obligatoires.`, {
      lotNumber: lotNumber ? "" : "Requis", expiryDate: expiryDate ? "" : "Requise",
    });
  }
}

// ---------------------------------------------------------------------------
// Opérations manuelles
// ---------------------------------------------------------------------------
const qty = z.union([z.number(), z.string().trim()]).pipe(z.coerce.number().int("Nombre entier attendu").min(1, "Au moins 1").max(1_000_000));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optDate = z.string().optional().transform((v) => v || null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date invalide");
const optCost = z.string().optional().transform((v, ctx) => {
  if (!v?.trim()) return null;
  const m = parseMRU(v);
  if (m === null) { ctx.addIssue({ code: "custom", message: "Coût invalide" }); return z.NEVER; }
  return m;
});

export const entrySchema = z.object({
  productId: z.string().uuid(),
  type: z.enum(["manual_in", "return_in"]),
  quantity: qty,
  lotNumber: optText(60),
  expiryDate: optDate,
  supplierId: z.string().uuid().nullable(),
  unitCost: optCost,
  reason: z.string().trim().min(3, "Motif requis").max(300),
});

export async function recordEntry(actor: Actor | null, input: z.input<typeof entrySchema>) {
  assertCan(actor, "stock.manage");
  const d = entrySchema.parse(input);
  await tx(async (db) => {
    await assertLotInfo(db, d.productId, d.lotNumber, d.expiryDate);
    const lotId = await findOrCreateLot(db, {
      productId: d.productId, lotNumber: d.lotNumber, expiryDate: d.expiryDate, supplierId: d.supplierId, unitCostMinor: d.unitCost,
    });
    const balance = await applyMovement(db, actor, { lotId, type: d.type, quantity: d.quantity, reason: d.reason });
    await audit(actor, "stock.entry", "product", d.productId, { after: { ...d, lotId, balance } }, db);
  });
}

export const exitSchema = z.object({
  productId: z.string().uuid(),
  lotId: z.string().uuid().nullable(),
  type: z.enum(["adjustment_out", "return_to_supplier", "loss", "expiry_writeoff"]),
  quantity: qty,
  reason: z.string().trim().min(3, "Motif requis").max(300),
});

/** Sortie de stock : sur un lot précis, ou par défaut « premier périmé, premier sorti » (FEFO). */
export async function recordExit(actor: Actor | null, input: z.input<typeof exitSchema>) {
  assertCan(actor, "stock.manage");
  const d = exitSchema.parse(input);
  if (d.type === "expiry_writeoff" && !d.lotId) throw new UserError("Choisissez le lot à mettre au rebut.", { lotId: "Lot requis" });
  await tx(async (db) => {
    const allocations = await allocateFefo(db, d.productId, d.quantity, d.lotId);
    for (const a of allocations) {
      await applyMovement(db, actor, { lotId: a.lotId, type: d.type, quantity: -a.quantity, reason: d.reason });
    }
    await audit(actor, "stock.exit", "product", d.productId, { after: { ...d, allocations } }, db);
  });
}

/**
 * Répartit une quantité sur le stock disponible (physique − réservé) des lots,
 * péremption la plus proche d'abord. Verrouille les lots pour la transaction,
 * ce qui sérialise les commandes et sorties concurrentes sur un même produit.
 */
export async function allocateFefo(db: PoolClient, productId: string, quantity: number, lotId: string | null = null) {
  const rows = await query<{ id: string; qty_on_hand: number; qty_reserved: number }>(
    `SELECT id, qty_on_hand, qty_reserved FROM stock_lots
      WHERE product_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
        AND ($2::uuid IS NOT NULL OR expiry_date IS NULL OR expiry_date >= current_date)
      ORDER BY expiry_date NULLS LAST, received_at, id
      FOR UPDATE`,
    [productId, lotId], db,
  );
  const lots = rows.map((l) => ({ id: l.id, qty_on_hand: l.qty_on_hand - l.qty_reserved })).filter((l) => l.qty_on_hand > 0);
  const available = lots.reduce((s, l) => s + l.qty_on_hand, 0);
  if (available < quantity) {
    throw new UserError(`Stock insuffisant : ${available} disponible(s)${lotId ? " dans ce lot" : " (lots non périmés)"}, ${quantity} demandé(s).`);
  }
  const out: { lotId: string; quantity: number }[] = [];
  let left = quantity;
  for (const l of lots) {
    if (left === 0) break;
    const take = Math.min(left, l.qty_on_hand);
    out.push({ lotId: l.id, quantity: take });
    left -= take;
  }
  return out;
}

export const countSchema = z.object({
  lotId: z.string().uuid(),
  counted: z.union([z.number(), z.string().trim()]).pipe(z.coerce.number().int("Nombre entier attendu").min(0).max(1_000_000)),
  reason: z.string().trim().min(3, "Motif requis").max(300),
});

/** Inventaire : aligne un lot sur la quantité comptée physiquement. */
export async function recordCount(actor: Actor | null, input: z.input<typeof countSchema>) {
  assertCan(actor, "stock.manage");
  const d = countSchema.parse(input);
  await tx(async (db) => {
    const lot = await queryOne<{ product_id: string; qty_on_hand: number }>(
      "SELECT product_id, qty_on_hand FROM stock_lots WHERE id = $1 FOR UPDATE", [d.lotId], db,
    );
    if (!lot) throw new UserError("Lot introuvable.");
    const delta = d.counted - lot.qty_on_hand;
    if (delta === 0) throw new UserError("La quantité comptée est identique au stock enregistré.");
    await applyMovement(db, actor, {
      lotId: d.lotId, type: delta > 0 ? "adjustment_in" : "adjustment_out", quantity: delta, reason: `Inventaire : ${d.reason}`,
    });
    await audit(actor, "stock.count", "product", lot.product_id,
      { before: { lotId: d.lotId, qty: lot.qty_on_hand }, after: { lotId: d.lotId, qty: d.counted } }, db);
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------
export type StockRow = {
  id: string; name: string; sku: string; status: string; track_lots: boolean; sale_unit: string;
  stock_alert_threshold: number; on_hand: number; reserved: number; physical: number; expired_qty: number; next_expiry: string | null;
};

// on_hand = disponible à la vente (non périmé, non réservé) ; physical = quantité physique non périmée.
const STOCK_SELECT = `
  SELECT p.id, p.name, p.sku, p.status, p.track_lots, p.sale_unit, p.stock_alert_threshold,
         coalesce(sum(l.qty_on_hand - l.qty_reserved) FILTER (WHERE l.expiry_date IS NULL OR l.expiry_date >= current_date), 0)::int AS on_hand,
         coalesce(sum(l.qty_reserved), 0)::int AS reserved,
         coalesce(sum(l.qty_on_hand) FILTER (WHERE l.expiry_date IS NULL OR l.expiry_date >= current_date), 0)::int AS physical,
         coalesce(sum(l.qty_on_hand) FILTER (WHERE l.expiry_date < current_date), 0)::int AS expired_qty,
         min(l.expiry_date) FILTER (WHERE l.qty_on_hand > 0 AND l.expiry_date >= current_date) AS next_expiry
    FROM products p LEFT JOIN stock_lots l ON l.product_id = p.id`;

export type StockFilter = "all" | "low" | "out" | "expiring";

export async function getStockOverview(actor: Actor | null, f: { q?: string; filter?: string; page?: number }) {
  assertCan(actor, "stock.manage");
  const alertDays = (await queryOne<{ d: number }>("SELECT expiry_alert_days AS d FROM store_settings WHERE id = 1"))?.d ?? 90;
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [alertDays];
  const where = ["p.status <> 'archived'"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length})`);
  }
  const having: Record<string, string> = {
    all: "true",
    out: "s.on_hand = 0",
    low: "s.on_hand > 0 AND s.on_hand <= s.stock_alert_threshold",
    expiring: "(s.next_expiry <= current_date + $1::int OR s.expired_qty > 0)",
  };
  const cond = having[f.filter ?? "all"] ?? "true";
  const base = `WITH s AS (${STOCK_SELECT} WHERE ${where.join(" AND ")} GROUP BY p.id) SELECT * FROM s WHERE ${cond} AND $1::int IS NOT NULL`;
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) x`, args))!.n;
  const items = await query<StockRow>(`${base} ORDER BY name LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), alertDays };
}

export type LotRow = {
  id: string; lot_number: string | null; expiry_date: string | null; qty_on_hand: number; qty_reserved: number; received_at: Date;
  supplier_name: string | null; unit_cost_minor: number | null; po_number: string | null;
};
export type MovementRow = {
  id: string; movement_type: MovementType; quantity: number; balance_after: number; reason: string | null;
  created_at: Date; lot_number: string | null; author: string | null; po_number: string | null; order_number: string | null;
};

export async function getProductStock(actor: Actor | null, productId: string) {
  assertCan(actor, "stock.manage");
  const product = await queryOne<StockRow>(`${STOCK_SELECT} WHERE p.id = $1 GROUP BY p.id`, [productId]);
  if (!product) return null;
  const lots = await query<LotRow>(
    `SELECT l.id, l.lot_number, l.expiry_date, l.qty_on_hand, l.qty_reserved, l.received_at, s.name AS supplier_name, l.unit_cost_minor,
            po.number AS po_number
       FROM stock_lots l LEFT JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN purchase_order_items i ON i.id = l.purchase_order_item_id LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      WHERE l.product_id = $1 ORDER BY (l.qty_on_hand > 0) DESC, l.expiry_date NULLS LAST, l.received_at`,
    [productId],
  );
  const movements = await query<MovementRow>(
    `SELECT m.id, m.movement_type, m.quantity, m.balance_after, m.reason, m.created_at, l.lot_number,
            pr.full_name AS author, po.number AS po_number, o.number AS order_number
       FROM inventory_movements m JOIN stock_lots l ON l.id = m.lot_id
       LEFT JOIN profiles pr ON pr.user_id = m.created_by LEFT JOIN purchase_orders po ON po.id = m.purchase_order_id
       LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.product_id = $1 ORDER BY m.created_at DESC, m.id LIMIT 200`,
    [productId],
  );
  return { product, lots, movements };
}

export type ExpiringLot = {
  lot_id: string; product_id: string; product_name: string; sku: string; lot_number: string | null;
  expiry_date: string; qty_on_hand: number; days_left: number;
};

export async function listExpiringLots(actor: Actor | null, days?: number) {
  assertCan(actor, "stock.manage");
  const alertDays = days ?? (await queryOne<{ d: number }>("SELECT expiry_alert_days AS d FROM store_settings WHERE id = 1"))?.d ?? 90;
  return query<ExpiringLot>(
    `SELECT l.id AS lot_id, p.id AS product_id, p.name AS product_name, p.sku, l.lot_number, l.expiry_date, l.qty_on_hand,
            (l.expiry_date - current_date) AS days_left
       FROM stock_lots l JOIN products p ON p.id = l.product_id
      WHERE l.qty_on_hand > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= current_date + $1::int
      ORDER BY l.expiry_date, p.name`,
    [alertDays],
  );
}

/** Quantités disponibles à la vente : lots non périmés, déduction faite des réservations. */
export async function getAvailability(productIds: string[], db?: Db): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await query<{ product_id: string; qty: number }>(
    `SELECT product_id, coalesce(sum(qty_on_hand - qty_reserved), 0)::int AS qty FROM stock_lots
      WHERE product_id = ANY($1::uuid[]) AND (expiry_date IS NULL OR expiry_date >= current_date)
      GROUP BY product_id`,
    [productIds], db,
  );
  const map = new Map(productIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.product_id, r.qty);
  return map;
}

export async function getStockAlertCounts(actor: Actor | null) {
  assertCan(actor, "dashboard.view");
  return (await queryOne<{ out_of_stock: number; low_stock: number; expiring_lots: number; expired_lots: number }>(
    `WITH s AS (${STOCK_SELECT} WHERE p.status IN ('published', 'unavailable') GROUP BY p.id)
     SELECT (SELECT count(*)::int FROM s WHERE on_hand = 0) AS out_of_stock,
            (SELECT count(*)::int FROM s WHERE on_hand > 0 AND on_hand <= stock_alert_threshold) AS low_stock,
            (SELECT count(*)::int FROM stock_lots WHERE qty_on_hand > 0 AND expiry_date >= current_date
               AND expiry_date <= current_date + (SELECT expiry_alert_days FROM store_settings WHERE id = 1)) AS expiring_lots,
            (SELECT count(*)::int FROM stock_lots WHERE qty_on_hand > 0 AND expiry_date < current_date) AS expired_lots`,
  ))!;
}
