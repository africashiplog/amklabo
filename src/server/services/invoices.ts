/**
 * Factures et avoirs.
 *
 *  - Brouillon : modifiable ; supprimable avec la permission invoices.delete.
 *  - Émission : numéro définitif attribué (séquence sans trou), coordonnées du
 *    magasin et du client figées ; la base refuse ensuite toute modification.
 *  - Annulation d'une facture émise : documentée (motif, auteur, date), le
 *    numéro n'est jamais réutilisé ; impossible si un règlement est enregistré.
 *  - Avoir : document correctif (total ou partiel) rattaché à une facture émise.
 * La conformité aux obligations légales mauritaniennes doit être validée par AMKLABO.
 */
import type { PoolClient } from "pg";
import { parseMRU } from "@/lib/money";
import { t } from "@/i18n/fr";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx } from "../db";
import { UnauthenticatedError, UserError } from "../errors";
import { can } from "../permissions";
import { notify } from "./notifications";
import { syncOrderPayment } from "./payments";
import { nextDocumentNumber } from "./purchasing";
import { z } from "../validation";

export const INVOICE_STATUS = { draft: "Brouillon", issued: "Émise", cancelled: "Annulée" } as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS;
export const PAYMENT_LABEL = { unpaid: "Impayée", partial: "Partiellement payée", paid: "Payée", none: "—" } as const;

export type SellerSnapshot = {
  store_name: string; tagline: string; legal_name: string | null; tax_id: string | null; trade_register: string | null;
  address_line: string | null; city: string | null; country: string; phone: string | null; email: string | null;
  bank_details: string | null; invoice_footer: string | null; logo_path: string | null; tax_label: string;
};

export type Invoice = {
  id: string; kind: "invoice" | "credit_note"; number: string | null; status: InvoiceStatus; order_id: string | null;
  order_number: string | null; customer_id: string; credited_invoice_id: string | null; credited_number: string | null;
  issue_date: string | null; due_date: string | null; seller: SellerSnapshot | null; buyer_name: string;
  buyer_business: string | null; buyer_address: string | null; buyer_phone: string | null; buyer_email: string | null;
  buyer_professional_id: string | null; shipping_minor: number; subtotal_minor: number; discount_minor: number;
  total_minor: number; tax_rate_bp: number; tax_included_minor: number; amount_paid_minor: number;
  payment_method: string | null; notes: string | null; created_at: Date; issued_at: Date | null; cancelled_at: Date | null;
  cancel_reason: string | null; created_by_name: string | null; issued_by_name: string | null; cancelled_by_name: string | null;
  credited_total_minor: number;
};

export type InvoiceItem = {
  id: string; product_id: string | null; sku: string | null; description: string; unit_label: string; quantity: number;
  unit_price_minor: number; discount_minor: number; line_total_minor: number; sort_order: number;
};

const SELECT = `
  SELECT i.*, o.number AS order_number, ci.number AS credited_number,
         pc.full_name AS created_by_name, pi.full_name AS issued_by_name, px.full_name AS cancelled_by_name,
         coalesce((SELECT sum(cn.total_minor) FROM invoices cn WHERE cn.credited_invoice_id = i.id AND cn.status = 'issued'), 0)::bigint AS credited_total_minor
    FROM invoices i
    LEFT JOIN orders o ON o.id = i.order_id
    LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id
    LEFT JOIN profiles pc ON pc.user_id = i.created_by
    LEFT JOIN profiles pi ON pi.user_id = i.issued_by
    LEFT JOIN profiles px ON px.user_id = i.cancelled_by`;

/** Statut de règlement dérivé (les paiements sont enregistrés en Phase 4). */
export function paymentState(inv: Pick<Invoice, "kind" | "status" | "total_minor" | "amount_paid_minor" | "credited_total_minor">) {
  if (inv.kind !== "invoice" || inv.status !== "issued") return "none" as const;
  const due = inv.total_minor - inv.credited_total_minor;
  if (inv.amount_paid_minor >= due) return "paid" as const;
  return inv.amount_paid_minor > 0 ? ("partial" as const) : ("unpaid" as const);
}

/** Part de taxe incluse dans un montant TTC (arrondi à l'unité mineure, demi au supérieur). */
export function includedTax(totalMinor: number, rateBp: number) {
  if (rateBp === 0) return 0;
  return Number((BigInt(totalMinor) * BigInt(rateBp) * 2n + BigInt(10000 + rateBp)) / (BigInt(10000 + rateBp) * 2n));
}

async function loadItems(id: string, db?: Parameters<typeof query>[2]) {
  return query<InvoiceItem>("SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, description", [id], db);
}

async function recomputeTotals(db: PoolClient, id: string) {
  await db.query(
    `UPDATE invoices i SET
        subtotal_minor = coalesce((SELECT sum(line_total_minor) FROM invoice_items WHERE invoice_id = i.id), 0),
        discount_minor = coalesce((SELECT sum(discount_minor) FROM invoice_items WHERE invoice_id = i.id), 0),
        total_minor = coalesce((SELECT sum(line_total_minor) FROM invoice_items WHERE invoice_id = i.id), 0) + i.shipping_minor
      WHERE id = $1`,
    [id],
  );
}

async function lockDraft(db: PoolClient, id: string) {
  const inv = await queryOne<{ status: InvoiceStatus; kind: string; credited_invoice_id: string | null }>(
    "SELECT status, kind, credited_invoice_id FROM invoices WHERE id = $1 FOR UPDATE", [id], db,
  );
  if (!inv) throw new UserError("Facture introuvable.");
  if (inv.status !== "draft") throw new UserError("Seul un brouillon peut être modifié.");
  return inv;
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
/** Prépare un brouillon de facture à partir d'une commande (copie des lignes et prix de la commande). */
export async function createInvoiceFromOrder(actor: Actor | null, orderId: string) {
  assertCan(actor, "invoices.manage");
  return tx(async (db) => {
    const o = await queryOne<{
      id: string; number: string; status: string; customer_id: string; customer_name: string; business_name: string | null;
      customer_phone: string | null; customer_email: string | null; ship_line1: string; ship_district: string | null; ship_city: string;
      shipping_minor: number;
    }>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId], db);
    if (!o) throw new UserError("Commande introuvable.");
    if (["new", "pending_confirmation", "cancelled"].includes(o.status)) {
      throw new UserError("La commande doit être confirmée (et non annulée) avant d'être facturée.");
    }
    const existing = await queryOne<{ number: string | null }>(
      "SELECT number FROM invoices WHERE order_id = $1 AND kind = 'invoice' AND status <> 'cancelled'", [orderId], db,
    );
    if (existing) throw new UserError(`Cette commande a déjà une facture${existing.number ? ` (${existing.number})` : " en brouillon"}.`);
    const pro = await queryOne<{ professional_id: string | null }>(
      "SELECT professional_id FROM business_accounts WHERE customer_id = $1 AND status = 'approved'", [o.customer_id], db,
    );
    const inv = await queryOne<{ id: string }>(
      `INSERT INTO invoices (order_id, customer_id, buyer_name, buyer_business, buyer_address, buyer_phone, buyer_email,
                             buyer_professional_id, shipping_minor, total_minor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
      [orderId, o.customer_id, o.customer_name, o.business_name, [o.ship_line1, o.ship_district, o.ship_city].filter(Boolean).join(", "),
       o.customer_phone, o.customer_email, pro?.professional_id ?? null, o.shipping_minor, actor.id],
      db,
    );
    const items = await query<{ product_id: string; sku: string; name: string; sale_unit: keyof typeof t.saleUnit; units_per_sale_unit: number; quantity: number; unit_price_minor: number; retail_unit_price_minor: number; line_total_minor: number }>(
      "SELECT * FROM order_items WHERE order_id = $1 ORDER BY name", [orderId], db,
    );
    for (const [i, it] of items.entries()) {
      const unit = t.saleUnit[it.sale_unit].toLowerCase() + (it.units_per_sale_unit > 1 ? ` de ${it.units_per_sale_unit}` : "");
      await db.query(
        `INSERT INTO invoice_items (invoice_id, product_id, sku, description, unit_label, quantity, unit_price_minor, discount_minor, line_total_minor, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [inv!.id, it.product_id, it.sku, it.name, unit, it.quantity, it.unit_price_minor,
         Math.max(it.retail_unit_price_minor - it.unit_price_minor, 0) * it.quantity, it.line_total_minor, i],
      );
    }
    await recomputeTotals(db, inv!.id);
    await audit(actor, "invoice.create_from_order", "invoice", inv!.id, { after: { orderId, order: o.number } }, db);
    return inv!.id;
  });
}

/** Facture manuelle (hors commande en ligne), en brouillon. */
export async function createManualInvoice(actor: Actor | null, customerId: string) {
  assertCan(actor, "invoices.manage");
  return tx(async (db) => {
    const c = await queryOne<{ full_name: string; email: string | null; phone: string | null; anonymized_at: Date | null }>(
      "SELECT full_name, email, phone, anonymized_at FROM customers WHERE id = $1", [customerId], db,
    );
    if (!c) throw new UserError("Client introuvable.", { customerId: "Introuvable" });
    if (c.anonymized_at) throw new UserError("Ce client a été anonymisé.");
    const b = await queryOne<{ establishment_name: string; address_line: string; city: string; professional_id: string | null }>(
      "SELECT establishment_name, address_line, city, professional_id FROM business_accounts WHERE customer_id = $1 AND status = 'approved'", [customerId], db,
    );
    const addr = await queryOne<{ line1: string; district: string | null; city: string }>(
      "SELECT line1, district, city FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at LIMIT 1", [customerId], db,
    );
    const address = b ? `${b.address_line}, ${b.city}` : addr ? [addr.line1, addr.district, addr.city].filter(Boolean).join(", ") : null;
    const inv = await queryOne<{ id: string }>(
      `INSERT INTO invoices (customer_id, buyer_name, buyer_business, buyer_address, buyer_phone, buyer_email, buyer_professional_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [customerId, c.full_name, b?.establishment_name ?? null, address, c.phone, c.email, b?.professional_id ?? null, actor.id], db,
    );
    await audit(actor, "invoice.create_manual", "invoice", inv!.id, { after: { customerId } }, db);
    return inv!.id;
  });
}

/** Avoir sur une facture émise : brouillon reprenant les lignes, à ajuster pour un avoir partiel. */
export async function createCreditNote(actor: Actor | null, invoiceId: string) {
  assertCan(actor, "invoices.manage");
  return tx(async (db) => {
    const inv = await queryOne<Invoice>(`${SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [invoiceId], db);
    if (!inv || inv.kind !== "invoice" || inv.status !== "issued") throw new UserError("Un avoir ne peut être établi que sur une facture émise.");
    if (inv.credited_total_minor >= inv.total_minor) throw new UserError("Cette facture a déjà été entièrement créditée.");
    const draft = await queryOne("SELECT 1 FROM invoices WHERE credited_invoice_id = $1 AND status = 'draft'", [invoiceId], db);
    if (draft) throw new UserError("Un avoir en brouillon existe déjà pour cette facture.");
    const cn = await queryOne<{ id: string }>(
      `INSERT INTO invoices (kind, credited_invoice_id, order_id, customer_id, buyer_name, buyer_business, buyer_address, buyer_phone,
                             buyer_email, buyer_professional_id, shipping_minor, created_by)
       SELECT 'credit_note', id, NULL, customer_id, buyer_name, buyer_business, buyer_address, buyer_phone, buyer_email,
              buyer_professional_id, 0, $2 FROM invoices WHERE id = $1 RETURNING id`,
      [invoiceId, actor.id], db,
    );
    for (const it of await loadItems(invoiceId, db)) {
      await db.query(
        `INSERT INTO invoice_items (invoice_id, product_id, sku, description, unit_label, quantity, unit_price_minor, discount_minor, line_total_minor, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9)`,
        [cn!.id, it.product_id, it.sku, it.description, it.unit_label, it.quantity, it.unit_price_minor, it.line_total_minor, it.sort_order],
      );
    }
    await recomputeTotals(db, cn!.id);
    await audit(actor, "credit_note.create", "invoice", cn!.id, { after: { creditedInvoice: inv.number } }, db);
    return cn!.id;
  });
}

// ---------------------------------------------------------------------------
// Modification des brouillons
// ---------------------------------------------------------------------------
export const lineSchema = z.object({
  description: z.string().trim().min(1, "Désignation requise").max(300),
  sku: z.string().trim().max(64).optional().transform((v) => v || null),
  unitLabel: z.string().trim().min(1).max(40),
  quantity: z.union([z.number(), z.string().trim()]).pipe(z.coerce.number().int("Nombre entier attendu").min(1).max(1_000_000)),
  unitPrice: z.string().transform((v, ctx) => {
    const m = parseMRU(v);
    if (m === null) { ctx.addIssue({ code: "custom", message: "Prix invalide" }); return z.NEVER; }
    return m;
  }),
});

export async function addInvoiceLine(actor: Actor | null, invoiceId: string, input: z.input<typeof lineSchema>) {
  assertCan(actor, "invoices.manage");
  const d = lineSchema.parse(input);
  await tx(async (db) => {
    const inv = await lockDraft(db, invoiceId);
    if (inv.kind === "credit_note") throw new UserError("Un avoir ne peut reprendre que des lignes de la facture d'origine.");
    await db.query(
      `INSERT INTO invoice_items (invoice_id, sku, description, unit_label, quantity, unit_price_minor, line_total_minor, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7, coalesce((SELECT max(sort_order) + 1 FROM invoice_items WHERE invoice_id = $1), 0))`,
      [invoiceId, d.sku, d.description, d.unitLabel, d.quantity, d.unitPrice, d.unitPrice * d.quantity],
    );
    await recomputeTotals(db, invoiceId);
    await audit(actor, "invoice.line_add", "invoice", invoiceId, { after: d }, db);
  });
}

/** Modifie la quantité d'une ligne de brouillon (0 = suppression). Pour un avoir : jamais au-delà de la facture d'origine. */
export async function setInvoiceLineQuantity(actor: Actor | null, lineId: string, quantity: number) {
  assertCan(actor, "invoices.manage");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new UserError("Quantité invalide.");
  await tx(async (db) => {
    const line = await queryOne<InvoiceItem & { invoice_id: string }>("SELECT * FROM invoice_items WHERE id = $1", [lineId], db);
    if (!line) throw new UserError("Ligne introuvable.");
    const inv = await lockDraft(db, line.invoice_id);
    if (inv.kind === "credit_note" && quantity > 0) {
      const orig = await queryOne<{ quantity: number }>(
        "SELECT quantity FROM invoice_items WHERE invoice_id = $1 AND description = $2 AND unit_price_minor = $3 AND sort_order = $4",
        [inv.credited_invoice_id, line.description, line.unit_price_minor, line.sort_order], db,
      );
      if (orig && quantity > orig.quantity) throw new UserError(`L'avoir ne peut pas dépasser la quantité facturée (${orig.quantity}).`);
    }
    if (quantity === 0) await db.query("DELETE FROM invoice_items WHERE id = $1", [lineId]);
    else {
      const unitDiscount = line.quantity ? Math.round(line.discount_minor / line.quantity) : 0;
      await db.query("UPDATE invoice_items SET quantity = $2::int, line_total_minor = unit_price_minor * $2::int, discount_minor = $3 WHERE id = $1",
        [lineId, quantity, unitDiscount * quantity]);
    }
    await recomputeTotals(db, line.invoice_id);
    await audit(actor, "invoice.line_update", "invoice", line.invoice_id, { before: { quantity: line.quantity }, after: { lineId, quantity } }, db);
  });
}

export const draftSchema = z.object({
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  shipping: z.string().transform((v, ctx) => {
    const m = parseMRU(v.trim() === "" ? "0" : v);
    if (m === null) { ctx.addIssue({ code: "custom", message: "Montant invalide" }); return z.NEVER; }
    return m;
  }),
  buyerName: z.string().trim().min(2).max(200),
  buyerBusiness: z.string().trim().max(200).optional().transform((v) => v || null),
  buyerAddress: z.string().trim().max(300).optional().transform((v) => v || null),
  buyerProfessionalId: z.string().trim().max(80).optional().transform((v) => v || null),
});

export async function updateDraft(actor: Actor | null, id: string, input: z.input<typeof draftSchema>) {
  assertCan(actor, "invoices.manage");
  const d = draftSchema.parse(input);
  await tx(async (db) => {
    const inv = await lockDraft(db, id);
    const shipping = inv.kind === "credit_note" ? 0 : d.shipping;
    await db.query(
      "UPDATE invoices SET notes=$2, shipping_minor=$3, buyer_name=$4, buyer_business=$5, buyer_address=$6, buyer_professional_id=$7 WHERE id=$1",
      [id, d.notes, shipping, d.buyerName, d.buyerBusiness, d.buyerAddress, d.buyerProfessionalId],
    );
    await recomputeTotals(db, id);
    await audit(actor, "invoice.draft_update", "invoice", id, { after: d }, db);
  });
}

export async function deleteDraft(actor: Actor | null, id: string) {
  assertCan(actor, "invoices.delete");
  await tx(async (db) => {
    await lockDraft(db, id);
    await db.query("DELETE FROM invoices WHERE id = $1", [id]);
    await audit(actor, "invoice.draft_delete", "invoice", id, {}, db);
  });
}

// ---------------------------------------------------------------------------
// Émission et annulation
// ---------------------------------------------------------------------------
export async function issueInvoice(actor: Actor | null, id: string) {
  assertCan(actor, "invoices.manage");
  return tx(async (db) => {
    const inv = await lockDraft(db, id);
    const items = await loadItems(id, db);
    if (items.length === 0) throw new UserError("Ajoutez au moins une ligne avant d'émettre.");
    const totals = (await queryOne<{ total_minor: number; customer_user: string | null; order_id: string | null }>(
      "SELECT i.total_minor, c.user_id AS customer_user, i.order_id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1", [id], db,
    ))!;
    if (totals.total_minor <= 0) throw new UserError("Le montant doit être supérieur à zéro.");
    if (inv.kind === "credit_note") {
      const orig = (await queryOne<{ total_minor: number; status: string; credited: number }>(
        `SELECT total_minor, status, coalesce((SELECT sum(total_minor) FROM invoices WHERE credited_invoice_id = $1 AND status = 'issued'), 0)::bigint AS credited
           FROM invoices WHERE id = $1 FOR UPDATE`, [inv.credited_invoice_id], db,
      ))!;
      if (orig.status !== "issued") throw new UserError("La facture d'origine n'est plus émise.");
      if (orig.credited + totals.total_minor > orig.total_minor) {
        throw new UserError("Le total des avoirs dépasserait le montant de la facture d'origine.");
      }
    }
    const s = (await queryOne<SellerSnapshot & { tax_rate_bp: number; invoice_due_days: number }>("SELECT * FROM store_settings WHERE id = 1", [], db))!;
    const seller: SellerSnapshot = {
      store_name: s.store_name, tagline: s.tagline, legal_name: s.legal_name, tax_id: s.tax_id, trade_register: s.trade_register,
      address_line: s.address_line, city: s.city, country: s.country, phone: s.phone, email: s.email, bank_details: s.bank_details,
      invoice_footer: s.invoice_footer, logo_path: s.logo_path, tax_label: s.tax_label,
    };
    const number = inv.kind === "credit_note"
      ? await nextDocumentNumber(db, "credit_note", "AV")
      : await nextDocumentNumber(db, "invoice", "FAC");
    const today = new Date().toISOString().slice(0, 10);
    const due = inv.kind === "invoice" ? new Date(Date.now() + s.invoice_due_days * 86_400_000).toISOString().slice(0, 10) : null;
    await db.query(
      `UPDATE invoices SET status = 'issued', number = $2, issue_date = $3, due_date = $4, seller = $5, tax_rate_bp = $6,
              tax_included_minor = $7, issued_by = $8, issued_at = now() WHERE id = $1`,
      [id, number, today, due, JSON.stringify(seller), s.tax_rate_bp, includedTax(totals.total_minor, s.tax_rate_bp), actor.id],
    );
    // Les règlements déjà encaissés sur la commande sont reportés sur la facture.
    if (inv.kind === "invoice" && totals.order_id) await syncOrderPayment(db, totals.order_id);
    await audit(actor, inv.kind === "credit_note" ? "credit_note.issue" : "invoice.issue", "invoice", id, { after: { number, total: totals.total_minor } }, db);
    await notify(db, totals.customer_user, `${inv.kind === "credit_note" ? "Avoir" : "Facture"} ${number} disponible`,
      "Vous pouvez la télécharger depuis votre espace client.", "/compte/factures");
    return number;
  });
}

export async function cancelInvoice(actor: Actor | null, id: string, reason: string) {
  assertCan(actor, "invoices.manage");
  const why = reason.trim();
  if (why.length < 3) throw new UserError("Indiquez le motif d'annulation.", { reason: "Motif requis" });
  await tx(async (db) => {
    const inv = await queryOne<Invoice>(`${SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [id], db);
    if (!inv) throw new UserError("Facture introuvable.");
    if (inv.status !== "issued") throw new UserError(inv.status === "draft" ? "Un brouillon se supprime, il ne s'annule pas." : "Cette facture est déjà annulée.");
    if (inv.amount_paid_minor > 0) throw new UserError("Un règlement est enregistré sur cette facture : établissez un avoir au lieu de l'annuler.");
    if (inv.credited_total_minor > 0) throw new UserError("Des avoirs ont été émis sur cette facture : elle ne peut plus être annulée.");
    await db.query("UPDATE invoices SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1",
      [id, actor.id, why]);
    await audit(actor, "invoice.cancel", "invoice", id, { before: { status: "issued" }, after: { status: "cancelled", reason: why, number: inv.number } }, db);
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------
export async function adminListInvoices(actor: Actor | null, f: { q?: string; status?: string; kind?: string; from?: string; to?: string; unpaid?: boolean; page?: number }) {
  assertCan(actor, "invoices.read");
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where = ["true"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(i.number ILIKE $${args.length} OR i.buyer_name ILIKE $${args.length} OR i.buyer_business ILIKE $${args.length} OR o.number ILIKE $${args.length})`);
  }
  if (f.status && f.status in INVOICE_STATUS) { args.push(f.status); where.push(`i.status = $${args.length}::invoice_status`); }
  if (f.kind === "invoice" || f.kind === "credit_note") { args.push(f.kind); where.push(`i.kind = $${args.length}::invoice_kind`); }
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) { args.push(f.from); where.push(`coalesce(i.issue_date, i.created_at::date) >= $${args.length}::date`); }
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) { args.push(f.to); where.push(`coalesce(i.issue_date, i.created_at::date) <= $${args.length}::date`); }
  if (f.unpaid) where.push(`i.kind = 'invoice' AND i.status = 'issued' AND i.amount_paid_minor <
      i.total_minor - coalesce((SELECT sum(cn.total_minor) FROM invoices cn WHERE cn.credited_invoice_id = i.id AND cn.status = 'issued'), 0)`);
  const w = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM invoices i LEFT JOIN orders o ON o.id = i.order_id WHERE ${w}`, args))!.n;
  const items = await query<Invoice>(`${SELECT} WHERE ${w} ORDER BY coalesce(i.issued_at, i.created_at) DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function adminGetInvoice(actor: Actor | null, id: string) {
  assertCan(actor, "invoices.read");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const invoice = await queryOne<Invoice>(`${SELECT} WHERE i.id = $1`, [id]);
  if (!invoice) return null;
  const creditNotes = await query<{ id: string; number: string | null; status: string; total_minor: number }>(
    "SELECT id, number, status, total_minor FROM invoices WHERE credited_invoice_id = $1 ORDER BY created_at", [id],
  );
  return { invoice, items: await loadItems(id), creditNotes };
}

/** Factures émises (ou annulées) du client connecté — jamais les brouillons ni celles d'un autre client. */
export async function listMyInvoices(actor: Actor | null) {
  if (!actor) throw new UnauthenticatedError();
  return query<Invoice>(
    `${SELECT} JOIN customers c ON c.id = i.customer_id WHERE c.user_id = $1 AND i.status <> 'draft' ORDER BY i.issued_at DESC`,
    [actor.id],
  );
}

/** Accès à une facture pour le PDF : personnel autorisé, ou client propriétaire d'une facture émise. */
export async function getInvoiceForViewer(actor: Actor | null, id: string) {
  if (!actor) throw new UnauthenticatedError();
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const invoice = await queryOne<Invoice & { owner_user_id: string | null }>(
    `${SELECT.replace("FROM invoices i", ", c.user_id AS owner_user_id FROM invoices i JOIN customers c ON c.id = i.customer_id")} WHERE i.id = $1`,
    [id],
  );
  if (!invoice) return null;
  const staff = can(actor.roles, "invoices.read");
  if (!staff && (invoice.owner_user_id !== actor.id || invoice.status === "draft")) return null;
  return { invoice, items: await loadItems(id) };
}
