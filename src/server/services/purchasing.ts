import type { PoolClient } from "pg";
import { parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx } from "../db";
import { UserError } from "../errors";
import { can } from "../permissions";
import { z } from "../validation";
import { applyMovement, assertLotInfo, findOrCreateLot } from "./stock";

/** Numéro de document séquentiel, sans trou, par année (ex. BA-2026-0001). */
export async function nextDocumentNumber(db: PoolClient, name: string, prefix: string, at = new Date()) {
  const year = at.getUTCFullYear();
  const row = await queryOne<{ last_value: number }>(
    `INSERT INTO document_sequences (name, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (name, year) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [name, year], db,
  );
  return `${prefix}-${year}-${String(row!.last_value).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------
export type Supplier = {
  id: string; name: string; contact_name: string | null; phone: string | null; email: string | null;
  address: string | null; country: string | null; notes: string | null; is_active: boolean;
};

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(200),
  contactName: opt(120),
  phone: opt(40),
  email: z.string().trim().email("Adresse e-mail invalide").max(200).optional().or(z.literal("")).transform((v) => v || null),
  address: opt(300),
  country: opt(80),
  notes: opt(2000),
  isActive: z.boolean(),
});

export async function listSuppliers(actor: Actor | null, activeOnly = false) {
  assertCan(actor, "suppliers.manage");
  return query<Supplier & { product_count: number; po_count: number }>(
    `SELECT s.*, (SELECT count(*)::int FROM product_suppliers ps WHERE ps.supplier_id = s.id) AS product_count,
            (SELECT count(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id) AS po_count
       FROM suppliers s WHERE ($1::boolean IS FALSE OR s.is_active) ORDER BY s.name`,
    [activeOnly],
  );
}

/** Liste minimale pour les formulaires de stock (gestionnaire de stock). */
export async function listSupplierOptions(actor: Actor | null) {
  assertCan(actor, "stock.manage");
  return query<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE is_active ORDER BY name");
}

export async function getSupplier(actor: Actor | null, id: string) {
  assertCan(actor, "suppliers.manage");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const supplier = await queryOne<Supplier>("SELECT * FROM suppliers WHERE id = $1", [id]);
  if (!supplier) return null;
  const products = await query<{ product_id: string; name: string; sku: string; supplier_sku: string | null; last_cost_minor: number | null }>(
    `SELECT ps.product_id, p.name, p.sku, ps.supplier_sku, ps.last_cost_minor FROM product_suppliers ps
       JOIN products p ON p.id = ps.product_id WHERE ps.supplier_id = $1 ORDER BY p.name`,
    [id],
  );
  return { supplier, products };
}

export async function saveSupplier(actor: Actor | null, id: string | null, input: z.input<typeof supplierSchema>) {
  assertCan(actor, "suppliers.manage");
  const d = supplierSchema.parse(input);
  const values = [d.name, d.contactName, d.phone, d.email, d.address, d.country, d.notes, d.isActive];
  try {
    return await tx(async (db) => {
      if (id) {
        const before = await queryOne("SELECT * FROM suppliers WHERE id = $1 FOR UPDATE", [id], db);
        if (!before) throw new UserError("Fournisseur introuvable.");
        const after = await queryOne(
          `UPDATE suppliers SET name=$1, contact_name=$2, phone=$3, email=$4, address=$5, country=$6, notes=$7, is_active=$8
            WHERE id=$9 RETURNING *`, [...values, id], db,
        );
        await audit(actor, "supplier.update", "supplier", id, { before, after }, db);
        return id;
      }
      const row = await queryOne<{ id: string }>(
        `INSERT INTO suppliers (name, contact_name, phone, email, address, country, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, values, db,
      );
      await audit(actor, "supplier.create", "supplier", row!.id, { after: row }, db);
      return row!.id;
    });
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Un fournisseur porte déjà ce nom.", { name: "Nom déjà utilisé" });
    throw err;
  }
}

export async function linkProductSupplier(actor: Actor | null, supplierId: string, productId: string, supplierSku: string | null) {
  assertCan(actor, "suppliers.manage");
  try {
    await query(
      `INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku) VALUES ($1, $2, $3)
       ON CONFLICT (product_id, supplier_id) DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku`,
      [productId, supplierId, supplierSku?.trim() || null],
    );
  } catch (err) {
    if (pgCode(err) === "23503") throw new UserError("Produit ou fournisseur introuvable.");
    throw err;
  }
  await audit(actor, "supplier.link_product", "supplier", supplierId, { after: { productId, supplierSku } });
}

export async function unlinkProductSupplier(actor: Actor | null, supplierId: string, productId: string) {
  assertCan(actor, "suppliers.manage");
  await query("DELETE FROM product_suppliers WHERE supplier_id = $1 AND product_id = $2", [supplierId, productId]);
  await audit(actor, "supplier.unlink_product", "supplier", supplierId, { before: { productId } });
}

// ---------------------------------------------------------------------------
// Bons d'achat
// ---------------------------------------------------------------------------
export const PO_STATUS = {
  draft: "Brouillon",
  ordered: "Commandé",
  partially_received: "Reçu partiellement",
  received: "Reçu",
  cancelled: "Annulé",
} as const;
export type PoStatus = keyof typeof PO_STATUS;

export type PurchaseOrder = {
  id: string; number: string; supplier_id: string; supplier_name: string; status: PoStatus; ordered_at: Date | null;
  expected_at: string | null; notes: string | null; created_at: Date; creator_name: string | null;
  item_count: number; total_cost_minor: number | null;
};
export type PoItem = {
  id: string; product_id: string; product_name: string; sku: string; track_lots: boolean; qty_ordered: number;
  qty_received: number; unit_cost_minor: number | null;
};

const PO_SELECT = `
  SELECT po.*, s.name AS supplier_name, pr.full_name AS creator_name,
         (SELECT count(*)::int FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS item_count,
         (SELECT sum(i.qty_ordered * i.unit_cost_minor) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS total_cost_minor
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN profiles pr ON pr.user_id = po.created_by`;

/** Masque les coûts pour les utilisateurs sans droit de les consulter. */
function hideCosts<T extends { total_cost_minor?: number | null; unit_cost_minor?: number | null }>(actor: Actor, rows: T[]): T[] {
  if (can(actor.roles, "stock.view_costs")) return rows;
  return rows.map((r) => ({ ...r, total_cost_minor: null, unit_cost_minor: null }));
}

export async function listPurchaseOrders(actor: Actor | null, status?: string) {
  assertCan(actor, "suppliers.manage");
  const valid = status && status in PO_STATUS ? status : null;
  return hideCosts(actor, await query<PurchaseOrder>(
    `${PO_SELECT} WHERE ($1::purchase_status IS NULL OR po.status = $1::purchase_status) ORDER BY po.created_at DESC LIMIT 200`,
    [valid],
  ));
}

export async function getPurchaseOrder(actor: Actor | null, id: string) {
  assertCan(actor, "suppliers.manage");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const po = await queryOne<PurchaseOrder>(`${PO_SELECT} WHERE po.id = $1`, [id]);
  if (!po) return null;
  const items = await query<PoItem>(
    `SELECT i.id, i.product_id, p.name AS product_name, p.sku, p.track_lots, i.qty_ordered, i.qty_received, i.unit_cost_minor
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id
      WHERE i.purchase_order_id = $1 ORDER BY p.name`,
    [id],
  );
  return { po: hideCosts(actor, [po])[0], items: hideCosts(actor, items) };
}

export const poSchema = z.object({
  supplierId: z.string().uuid("Fournisseur requis"),
  expectedAt: z.string().optional().transform((v) => v || null).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date invalide"),
  notes: opt(2000),
});

export async function createPurchaseOrder(actor: Actor | null, input: z.input<typeof poSchema>) {
  assertCan(actor, "suppliers.manage");
  const d = poSchema.parse(input);
  return tx(async (db) => {
    const s = await queryOne<{ is_active: boolean }>("SELECT is_active FROM suppliers WHERE id = $1", [d.supplierId], db);
    if (!s) throw new UserError("Fournisseur introuvable.", { supplierId: "Introuvable" });
    if (!s.is_active) throw new UserError("Ce fournisseur est désactivé.", { supplierId: "Désactivé" });
    const number = await nextDocumentNumber(db, "purchase_order", "BA");
    const row = await queryOne<{ id: string }>(
      `INSERT INTO purchase_orders (number, supplier_id, expected_at, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [number, d.supplierId, d.expectedAt, d.notes, actor.id], db,
    );
    await audit(actor, "purchase.create", "purchase_order", row!.id, { after: { number, ...d } }, db);
    return { id: row!.id, number };
  });
}

async function lockPo(db: PoolClient, id: string) {
  const po = await queryOne<{ status: PoStatus; supplier_id: string; number: string }>(
    "SELECT status, supplier_id, number FROM purchase_orders WHERE id = $1 FOR UPDATE", [id], db,
  );
  if (!po) throw new UserError("Bon d'achat introuvable.");
  return po;
}

export const poItemSchema = z.object({
  productId: z.string().uuid("Produit requis"),
  quantity: z.union([z.number(), z.string().trim()]).pipe(z.coerce.number<string | number>().int("Nombre entier attendu").min(1).max(1_000_000)),
  unitCost: z.string().optional().transform((v, ctx) => {
    if (!v?.trim()) return null;
    const m = parseMRU(v);
    if (m === null) { ctx.addIssue({ code: "custom", message: "Coût invalide" }); return z.NEVER; }
    return m;
  }),
});

export async function addPoItem(actor: Actor | null, poId: string, input: z.input<typeof poItemSchema>) {
  assertCan(actor, "suppliers.manage");
  const d = poItemSchema.parse(input);
  await tx(async (db) => {
    const po = await lockPo(db, poId);
    if (po.status !== "draft") throw new UserError("Seul un bon d'achat en brouillon peut être modifié.");
    const p = await queryOne("SELECT 1 FROM products WHERE id = $1", [d.productId], db);
    if (!p) throw new UserError("Produit introuvable.", { productId: "Introuvable" });
    await db.query(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, qty_ordered, unit_cost_minor) VALUES ($1,$2,$3,$4)
       ON CONFLICT (purchase_order_id, product_id) DO UPDATE SET qty_ordered = EXCLUDED.qty_ordered, unit_cost_minor = EXCLUDED.unit_cost_minor`,
      [poId, d.productId, d.quantity, d.unitCost],
    );
    await audit(actor, "purchase.item_set", "purchase_order", poId, { after: d }, db);
  });
}

export async function removePoItem(actor: Actor | null, itemId: string) {
  assertCan(actor, "suppliers.manage");
  await tx(async (db) => {
    const item = await queryOne<{ purchase_order_id: string }>("SELECT purchase_order_id FROM purchase_order_items WHERE id = $1", [itemId], db);
    if (!item) throw new UserError("Ligne introuvable.");
    const po = await lockPo(db, item.purchase_order_id);
    if (po.status !== "draft") throw new UserError("Seul un bon d'achat en brouillon peut être modifié.");
    await db.query("DELETE FROM purchase_order_items WHERE id = $1", [itemId]);
    await audit(actor, "purchase.item_remove", "purchase_order", item.purchase_order_id, { before: { itemId } }, db);
  });
}

export async function markPoOrdered(actor: Actor | null, poId: string) {
  assertCan(actor, "suppliers.manage");
  await tx(async (db) => {
    const po = await lockPo(db, poId);
    if (po.status !== "draft") throw new UserError("Ce bon d'achat a déjà été envoyé.");
    const n = (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM purchase_order_items WHERE purchase_order_id = $1", [poId], db))!.n;
    if (n === 0) throw new UserError("Ajoutez au moins un produit avant de valider la commande.");
    await db.query("UPDATE purchase_orders SET status = 'ordered', ordered_at = now() WHERE id = $1", [poId]);
    await audit(actor, "purchase.ordered", "purchase_order", poId, { before: { status: "draft" }, after: { status: "ordered" } }, db);
  });
}

export async function cancelPurchaseOrder(actor: Actor | null, poId: string, reason: string) {
  assertCan(actor, "suppliers.manage");
  if (!reason.trim()) throw new UserError("Indiquez le motif d'annulation.", { reason: "Motif requis" });
  await tx(async (db) => {
    const po = await lockPo(db, poId);
    if (!["draft", "ordered"].includes(po.status)) {
      throw new UserError("Un bon d'achat déjà (partiellement) reçu ne peut pas être annulé.");
    }
    await db.query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", [poId]);
    await audit(actor, "purchase.cancel", "purchase_order", poId, { before: { status: po.status }, after: { status: "cancelled", reason } }, db);
  });
}

export type ReceiptLine = { itemId: string; quantity: number; lotNumber: string | null; expiryDate: string | null };

/**
 * Réception (totale ou partielle) : crée un lot par ligne reçue, enregistre un
 * mouvement « Réception fournisseur » et met à jour le statut du bon d'achat.
 */
export async function receivePurchaseOrder(actor: Actor | null, poId: string, lines: ReceiptLine[]) {
  assertCan(actor, "stock.manage");
  assertCan(actor, "suppliers.manage");
  const useful = lines.filter((l) => l.quantity !== 0);
  if (useful.length === 0) throw new UserError("Indiquez au moins une quantité reçue.");
  for (const l of useful) {
    if (!Number.isInteger(l.quantity) || l.quantity < 0) throw new UserError("Quantité reçue invalide.");
    if (l.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate)) throw new UserError("Date de péremption invalide.");
  }
  await tx(async (db) => {
    const po = await lockPo(db, poId);
    if (!["ordered", "partially_received"].includes(po.status)) {
      throw new UserError("Ce bon d'achat n'est pas en attente de réception.");
    }
    for (const l of useful) {
      const item = await queryOne<{ product_id: string; qty_ordered: number; qty_received: number; unit_cost_minor: number | null }>(
        "SELECT product_id, qty_ordered, qty_received, unit_cost_minor FROM purchase_order_items WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE",
        [l.itemId, poId], db,
      );
      if (!item) throw new UserError("Ligne de bon d'achat introuvable.");
      const remaining = item.qty_ordered - item.qty_received;
      if (l.quantity > remaining) throw new UserError(`Quantité reçue supérieure au reste à recevoir (${remaining}).`);
      const lotNumber = l.lotNumber?.trim() || null;
      await assertLotInfo(db, item.product_id, lotNumber, l.expiryDate);
      const lotId = await findOrCreateLot(db, {
        productId: item.product_id, lotNumber, expiryDate: l.expiryDate, supplierId: po.supplier_id,
        purchaseOrderItemId: l.itemId, unitCostMinor: item.unit_cost_minor,
      });
      await applyMovement(db, actor, { lotId, type: "purchase_receipt", quantity: l.quantity, reason: `Réception ${po.number}`, purchaseOrderId: poId });
      await db.query("UPDATE purchase_order_items SET qty_received = qty_received + $2 WHERE id = $1", [l.itemId, l.quantity]);
      await db.query(
        `INSERT INTO product_suppliers (product_id, supplier_id, last_cost_minor) VALUES ($1, $2, $3)
         ON CONFLICT (product_id, supplier_id) DO UPDATE SET last_cost_minor = coalesce(EXCLUDED.last_cost_minor, product_suppliers.last_cost_minor)`,
        [item.product_id, po.supplier_id, item.unit_cost_minor],
      );
    }
    const left = (await queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM purchase_order_items WHERE purchase_order_id = $1 AND qty_received < qty_ordered", [poId], db,
    ))!.n;
    const status = left === 0 ? "received" : "partially_received";
    await db.query("UPDATE purchase_orders SET status = $2 WHERE id = $1", [poId, status]);
    await audit(actor, "purchase.receive", "purchase_order", poId, { before: { status: po.status }, after: { status, lines: useful } }, db);
  });
}
