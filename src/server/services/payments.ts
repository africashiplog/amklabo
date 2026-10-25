/**
 * Paiements — procédure de vérification manuelle.
 *
 * Aucune intégration officielle (API) de Bankily, Masrivi, Sedad, Bimbank ou
 * Click n'est disponible dans ce projet : aucun paiement n'est jamais confirmé
 * automatiquement, ni à partir d'une simple capture d'écran.
 *
 *  1. Le client voit les instructions et le compte marchand officiel saisis par AMKLABO.
 *  2. Il transmet la référence de sa transaction (et un justificatif facultatif).
 *  3. Le paiement est « en attente de vérification ».
 *  4. Une personne autorisée le confirme (montant réellement reçu) ou le refuse.
 *  5. Son identité, la date et la référence sont enregistrées ; le client est notifié.
 *
 * Espèces à la livraison : le livreur déclare le montant encaissé, le comptable
 * confirme la remise des espèces.
 * Aucun code PIN, mot de passe ou code secret n'est jamais demandé ni stocké.
 */
import type { PoolClient } from "pg";
import { formatMRU, parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx, type Db } from "../db";
import { ForbiddenError, UnauthenticatedError, UserError } from "../errors";
import { can } from "../permissions";
import { deleteStoredFile, saveImage } from "../storage";
import { z } from "../validation";
import { notify } from "./notifications";

export type PaymentMethod = {
  code: string; name: string; kind: "cash_on_delivery" | "mobile_money"; is_active: boolean; instructions: string | null;
  merchant_account: string | null; reference_label: string; requires_reference: boolean; allows_proof: boolean; sort_order: number;
};

export const PAYMENT_RECORD_STATUS = {
  pending_verification: "En attente de vérification",
  confirmed: "Confirmé",
  refused: "Refusé",
  failed: "Échoué",
} as const;

export async function listActiveMethods(db?: Db) {
  return query<PaymentMethod>("SELECT * FROM payment_methods WHERE is_active ORDER BY sort_order", [], db);
}

export async function adminListMethods(actor: Actor | null) {
  assertCan(actor, "settings.manage");
  return query<PaymentMethod>("SELECT * FROM payment_methods ORDER BY sort_order");
}

export const methodSchema = z.object({
  isActive: z.boolean(),
  instructions: z.string().trim().max(2000).optional().transform((v) => v || null),
  merchantAccount: z.string().trim().max(120).optional().transform((v) => v || null),
  referenceLabel: z.string().trim().min(3).max(80),
});

export async function saveMethod(actor: Actor | null, code: string, input: z.input<typeof methodSchema>) {
  assertCan(actor, "settings.manage");
  const d = methodSchema.parse(input);
  await tx(async (db) => {
    const before = await queryOne<PaymentMethod>("SELECT * FROM payment_methods WHERE code = $1 FOR UPDATE", [code], db);
    if (!before) throw new UserError("Moyen de paiement inconnu.");
    if (d.isActive && before.kind === "mobile_money" && !d.merchantAccount) {
      throw new UserError("Saisissez le numéro ou compte marchand officiel avant d'activer ce moyen de paiement.", { merchantAccount: "Requis pour l'activation" });
    }
    const after = await queryOne(
      `UPDATE payment_methods SET is_active=$2, instructions=$3, merchant_account=$4, reference_label=$5, updated_by=$6
        WHERE code=$1 RETURNING *`,
      [code, d.isActive, d.instructions, d.merchantAccount, d.referenceLabel, actor.id], db,
    );
    await audit(actor, "payment_method.update", "payment_method", code, { before, after }, db);
  });
}

// ---------------------------------------------------------------------------
// Calcul des soldes et statuts
// ---------------------------------------------------------------------------
type Totals = { paid: number; refunded: number; pending: number; lastRefused: boolean };

async function totalsFor(db: Db | undefined, column: "order_id" | "invoice_id", id: string): Promise<Totals> {
  const r = (await queryOne<{ paid: number; refunded: number; pending: number; last_refused: boolean }>(
    `SELECT coalesce(sum(amount_minor) FILTER (WHERE kind = 'payment' AND status = 'confirmed'), 0)::bigint AS paid,
            coalesce(sum(amount_minor) FILTER (WHERE kind = 'refund' AND status = 'confirmed'), 0)::bigint AS refunded,
            coalesce(sum(amount_minor) FILTER (WHERE kind = 'payment' AND status = 'pending_verification'), 0)::bigint AS pending,
            coalesce((SELECT status = 'refused' FROM payments WHERE ${column} = $1 AND kind = 'payment' ORDER BY submitted_at DESC LIMIT 1), false) AS last_refused
       FROM payments WHERE ${column} = $1`,
    [id], db,
  ))!;
  return { paid: r.paid, refunded: r.refunded, pending: r.pending, lastRefused: r.last_refused };
}

export function derivePaymentStatus(total: number, t: Totals) {
  const net = t.paid - t.refunded;
  if (t.refunded > 0) return net <= 0 ? "refunded" : "partially_refunded";
  if (net >= total && total > 0) return "paid";
  if (t.pending > 0) return "awaiting_verification";
  if (net > 0) return "partially_paid";
  if (t.lastRefused) return "refused";
  return "awaiting_payment";
}

/** Met à jour le statut de paiement de la commande et le montant réglé de sa facture émise. */
export async function syncOrderPayment(db: PoolClient, orderId: string) {
  const o = await queryOne<{ total_minor: number }>("SELECT total_minor FROM orders WHERE id = $1", [orderId], db);
  if (!o) return;
  const t = await totalsFor(db, "order_id", orderId);
  await db.query("UPDATE orders SET payment_status = $2 WHERE id = $1", [orderId, derivePaymentStatus(o.total_minor, t)]);
  const net = Math.max(t.paid - t.refunded, 0);
  await db.query(
    `UPDATE invoices SET amount_paid_minor = least($2::bigint, total_minor)
      WHERE order_id = $1 AND kind = 'invoice' AND status = 'issued' AND amount_paid_minor <> least($2::bigint, total_minor)`,
    [orderId, net],
  );
}

async function syncInvoicePayment(db: PoolClient, invoiceId: string) {
  const t = await totalsFor(db, "invoice_id", invoiceId);
  await db.query(
    "UPDATE invoices SET amount_paid_minor = least(greatest($2::bigint, 0), total_minor) WHERE id = $1 AND status = 'issued'",
    [invoiceId, t.paid - t.refunded],
  );
}

async function sync(db: PoolClient, target: { orderId: string | null; invoiceId: string | null }) {
  if (target.orderId) await syncOrderPayment(db, target.orderId);
  if (target.invoiceId) await syncInvoicePayment(db, target.invoiceId);
}

async function event(db: PoolClient, paymentId: string, ev: string, actor: Actor | null, note: string | null) {
  await db.query(
    "INSERT INTO payment_events (payment_id, event, note, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5)",
    [paymentId, ev, note, actor?.id ?? null, actor?.fullName ?? null],
  );
}

/** Montant restant dû sur une commande, paiements en attente déduits. */
export async function orderAmountDue(db: Db | undefined, orderId: string) {
  const o = await queryOne<{ total_minor: number }>("SELECT total_minor FROM orders WHERE id = $1", [orderId], db);
  if (!o) return 0;
  const t = await totalsFor(db, "order_id", orderId);
  return Math.max(o.total_minor - (t.paid - t.refunded) - t.pending, 0);
}

async function invoiceDue(db: Db, invoiceId: string) {
  const inv = await queryOne<{ total_minor: number; credited: number }>(
    `SELECT total_minor, coalesce((SELECT sum(total_minor) FROM invoices WHERE credited_invoice_id = $1 AND status = 'issued'), 0)::bigint AS credited
       FROM invoices WHERE id = $1`, [invoiceId], db,
  );
  if (!inv) return 0;
  const t = await totalsFor(db, "invoice_id", invoiceId);
  return Math.max(inv.total_minor - inv.credited - (t.paid - t.refunded) - t.pending, 0);
}

const REFERENCE = /^[A-Za-z0-9._/-]{3,64}$/;

function mapUnique(err: unknown): never {
  if (pgCode(err) === "23505") throw new UserError("Cette référence de transaction a déjà été utilisée pour un autre paiement.", { reference: "Référence déjà utilisée" });
  if (pgCode(err) === "23514") throw new UserError("Référence de transaction invalide (lettres, chiffres, . _ / - uniquement).", { reference: "Format invalide" });
  throw err;
}

// ---------------------------------------------------------------------------
// Client : déclaration d'un paiement électronique
// ---------------------------------------------------------------------------
export async function submitPayment(
  actor: Actor | null,
  orderNumber: string,
  input: { reference: string; payerPhone?: string | null; proof?: File | null },
) {
  if (!actor) throw new UnauthenticatedError();
  const reference = input.reference.trim();
  const payerPhone = input.payerPhone?.trim().slice(0, 30) || null;
  if (payerPhone && !/^\+?[0-9 ]{8,20}$/.test(payerPhone)) throw new UserError("Numéro de téléphone invalide.", { payerPhone: "Format invalide" });
  // Le justificatif est enregistré avant la transaction (fichier privé, non public).
  let proofPath: string | null = null;
  try {
    return await tx(async (db) => {
      const o = await queryOne<{ id: string; status: string; payment_method_code: string | null; customer_user: string }>(
        `SELECT o.id, o.status, o.payment_method_code, c.user_id AS customer_user
           FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.number = $1 AND c.user_id = $2 FOR UPDATE OF o`,
        [orderNumber, actor.id], db,
      );
      if (!o) throw new UserError("Commande introuvable.");
      if (["cancelled", "returned"].includes(o.status)) throw new UserError("Cette commande n'attend pas de paiement.");
      const m = o.payment_method_code
        ? await queryOne<PaymentMethod>("SELECT * FROM payment_methods WHERE code = $1", [o.payment_method_code], db)
        : null;
      if (!m || m.kind !== "mobile_money") throw new UserError("Le moyen de paiement de cette commande ne nécessite pas de déclaration en ligne.");
      if (!m.is_active) throw new UserError("Ce moyen de paiement n'est plus disponible : contactez-nous.");
      if (m.requires_reference && !REFERENCE.test(reference)) {
        throw new UserError(`Indiquez la ${m.reference_label.toLowerCase()} (lettres et chiffres).`, { reference: "Référence requise" });
      }
      const pendingCount = (await queryOne<{ n: number }>(
        "SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND status = 'pending_verification'", [o.id], db,
      ))!.n;
      if (pendingCount >= 3) throw new UserError("Plusieurs paiements sont déjà en attente de vérification pour cette commande.");
      const due = await orderAmountDue(db, o.id);
      if (due <= 0) throw new UserError("Le montant de cette commande est déjà réglé ou en cours de vérification.");
      if (input.proof && input.proof.size > 0) {
        if (!m.allows_proof) throw new UserError("Ce moyen de paiement n'accepte pas de justificatif.");
        proofPath = await saveImage(input.proof, "payments", ["png", "jpg"]);
      }
      const row = await queryOne<{ id: string }>(
        `INSERT INTO payments (order_id, method_code, amount_minor, transaction_reference, payer_phone, proof_path, submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [o.id, m.code, due, reference || null, payerPhone, proofPath, actor.id], db,
      );
      await event(db, row!.id, "submitted", actor, `Référence ${reference}`);
      await syncOrderPayment(db, o.id);
      await audit(actor, "payment.submit", "payment", row!.id, { after: { order: orderNumber, method: m.code, amount: due, reference } }, db);
      return { id: row!.id, amount: due };
    });
  } catch (err) {
    if (proofPath) await deleteStoredFile(proofPath);
    mapUnique(err);
  }
}

// ---------------------------------------------------------------------------
// Équipe : vérification, enregistrement direct, remboursement
// ---------------------------------------------------------------------------
async function customerUserOf(db: Db, p: { order_id: string | null; invoice_id: string | null }) {
  const r = await queryOne<{ user_id: string | null; label: string; link: string }>(
    p.order_id
      ? "SELECT c.user_id, o.number AS label, '/compte/commandes/' || o.number AS link FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1"
      : "SELECT c.user_id, coalesce(i.number, 'facture') AS label, '/compte/factures' AS link FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1",
    [p.order_id ?? p.invoice_id], db,
  );
  return r ?? { user_id: null, label: "", link: "" };
}

export async function verifyPayment(
  actor: Actor | null, paymentId: string, decision: "confirm" | "refuse", input: { amount?: string | null; note?: string | null },
) {
  assertCan(actor, "payments.verify");
  const note = input.note?.trim().slice(0, 1000) || null;
  if (decision === "refuse" && !note) throw new UserError("Indiquez le motif du refus.", { note: "Motif requis" });
  await tx(async (db) => {
    // Verrou : deux vérifications simultanées ne peuvent pas confirmer deux fois.
    const p = await queryOne<{ status: string; kind: string; amount_minor: number; order_id: string | null; invoice_id: string | null; method_code: string; transaction_reference: string | null }>(
      "SELECT status, kind, amount_minor, order_id, invoice_id, method_code, transaction_reference FROM payments WHERE id = $1 FOR UPDATE",
      [paymentId], db,
    );
    if (!p) throw new UserError("Paiement introuvable.");
    if (p.status !== "pending_verification") throw new UserError("Ce paiement a déjà été traité.");
    let amount = p.amount_minor;
    if (decision === "confirm" && input.amount?.trim()) {
      const m = parseMRU(input.amount);
      if (m === null || m <= 0) throw new UserError("Montant reçu invalide.", { amount: "Montant invalide" });
      amount = m;
    }
    await db.query(
      `UPDATE payments SET status = $2, amount_minor = $3, verified_by = $4, verified_at = now(), decision_note = $5 WHERE id = $1`,
      [paymentId, decision === "confirm" ? "confirmed" : "refused", amount, actor.id, note],
    );
    await event(db, paymentId, decision === "confirm" ? "confirmed" : "refused", actor,
      decision === "confirm" ? `Montant reçu : ${formatMRU(amount)}${note ? ` — ${note}` : ""}` : note);
    await sync(db, { orderId: p.order_id, invoiceId: p.invoice_id });
    await audit(actor, decision === "confirm" ? "payment.confirm" : "payment.refuse", "payment", paymentId,
      { before: { status: p.status, amount: p.amount_minor }, after: { amount, note, reference: p.transaction_reference } }, db);
    const who = await customerUserOf(db, p);
    await notify(db, who.user_id,
      decision === "confirm" ? `Paiement confirmé (${who.label})` : `Paiement refusé (${who.label})`,
      decision === "confirm" ? `Montant reçu : ${formatMRU(amount)}.` : note, who.link);
  });
}

export const recordSchema = z.object({
  methodCode: z.string().min(2),
  amount: z.string().transform((v, ctx) => {
    const m = parseMRU(v);
    if (m === null || m <= 0) { ctx.addIssue({ code: "custom", message: "Montant invalide" }); return z.NEVER; }
    return m;
  }),
  reference: z.string().trim().max(64).optional().transform((v) => v || null),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/**
 * Enregistrement direct d'un règlement constaté par une personne habilitée
 * (espèces remises en caisse, virement vérifié…). Il est confirmé en son nom.
 */
export async function recordPayment(actor: Actor | null, target: { orderId?: string | null; invoiceId?: string | null }, input: z.input<typeof recordSchema>) {
  assertCan(actor, "payments.verify");
  const d = recordSchema.parse(input);
  if (!!target.orderId === !!target.invoiceId) throw new UserError("Cible du paiement invalide.");
  try {
    await tx(async (db) => {
      const m = await queryOne<PaymentMethod>("SELECT * FROM payment_methods WHERE code = $1", [d.methodCode], db);
      if (!m) throw new UserError("Moyen de paiement inconnu.", { methodCode: "Inconnu" });
      if (m.kind === "mobile_money" && !d.reference) throw new UserError("La référence de transaction est obligatoire.", { reference: "Requise" });
      if (target.orderId) {
        const o = await queryOne<{ status: string }>("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [target.orderId], db);
        if (!o) throw new UserError("Commande introuvable.");
        if (o.status === "cancelled") throw new UserError("Commande annulée.");
      } else {
        const inv = await queryOne<{ status: string; kind: string; order_id: string | null }>(
          "SELECT status, kind, order_id FROM invoices WHERE id = $1 FOR UPDATE", [target.invoiceId], db,
        );
        if (!inv || inv.kind !== "invoice" || inv.status !== "issued") throw new UserError("Seule une facture émise peut recevoir un règlement.");
        if (inv.order_id) throw new UserError("Cette facture provient d'une commande : enregistrez le règlement sur la commande.");
      }
      const due = target.orderId ? await orderAmountDue(db, target.orderId) : await invoiceDue(db, target.invoiceId!);
      if (d.amount > due) throw new UserError(`Le montant dépasse le reste à payer (${formatMRU(due)}).`, { amount: "Supérieur au reste dû" });
      const row = await queryOne<{ id: string }>(
        `INSERT INTO payments (order_id, invoice_id, method_code, amount_minor, status, transaction_reference, note, submitted_by, verified_by, verified_at)
         VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$7,now()) RETURNING id`,
        [target.orderId ?? null, target.invoiceId ?? null, d.methodCode, d.amount, d.reference, d.note, actor.id], db,
      );
      await event(db, row!.id, "recorded", actor, d.note);
      await sync(db, { orderId: target.orderId ?? null, invoiceId: target.invoiceId ?? null });
      await audit(actor, "payment.record", "payment", row!.id, { after: { ...d, ...target } }, db);
    });
  } catch (err) {
    mapUnique(err);
  }
}

export async function recordRefund(actor: Actor | null, target: { orderId?: string | null; invoiceId?: string | null }, input: z.input<typeof recordSchema>) {
  assertCan(actor, "payments.refund");
  const d = recordSchema.parse(input);
  if (!d.note) throw new UserError("Indiquez le motif du remboursement.", { note: "Motif requis" });
  if (!!target.orderId === !!target.invoiceId) throw new UserError("Cible du remboursement invalide.");
  await tx(async (db) => {
    const column = target.orderId ? "order_id" : "invoice_id";
    const id = (target.orderId ?? target.invoiceId)!;
    await db.query(`SELECT 1 FROM ${target.orderId ? "orders" : "invoices"} WHERE id = $1 FOR UPDATE`, [id]);
    const t = await totalsFor(db, column, id);
    const refundable = t.paid - t.refunded;
    if (d.amount > refundable) throw new UserError(`Le remboursement dépasse les sommes encaissées (${formatMRU(refundable)}).`, { amount: "Trop élevé" });
    const row = await queryOne<{ id: string }>(
      `INSERT INTO payments (kind, order_id, invoice_id, method_code, amount_minor, status, transaction_reference, note, submitted_by, verified_by, verified_at)
       VALUES ('refund',$1,$2,$3,$4,'confirmed',$5,$6,$7,$7,now()) RETURNING id`,
      [target.orderId ?? null, target.invoiceId ?? null, d.methodCode, d.amount, d.reference, d.note, actor.id], db,
    );
    await event(db, row!.id, "refunded", actor, d.note);
    await sync(db, { orderId: target.orderId ?? null, invoiceId: target.invoiceId ?? null });
    await audit(actor, "payment.refund", "payment", row!.id, { after: { ...d, ...target } }, db);
    const who = await customerUserOf(db, { order_id: target.orderId ?? null, invoice_id: target.invoiceId ?? null });
    await notify(db, who.user_id, `Remboursement de ${formatMRU(d.amount)} (${who.label})`, d.note, who.link);
  });
}

/** Déclaration d'espèces encaissées à la livraison (par le livreur), à confirmer par le comptable. */
export async function declareCashCollected(db: PoolClient, actor: Actor, orderId: string, amountMinor: number, note: string | null) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return;
  const due = await orderAmountDue(db, orderId);
  if (amountMinor > due) throw new UserError(`Le montant encaissé dépasse le reste à payer (${formatMRU(due)}).`, { collected: "Trop élevé" });
  const row = await queryOne<{ id: string }>(
    `INSERT INTO payments (order_id, method_code, amount_minor, note, submitted_by)
     VALUES ($1, 'cash_on_delivery', $2, $3, $4) RETURNING id`,
    [orderId, amountMinor, note ?? `Espèces encaissées à la livraison par ${actor.fullName}`, actor.id], db,
  );
  await event(db, row!.id, "cash_collected", actor, `Encaissé : ${formatMRU(amountMinor)} — remise en caisse à confirmer`);
  await syncOrderPayment(db, orderId);
  await audit(actor, "payment.cash_collected", "payment", row!.id, { after: { orderId, amount: amountMinor } }, db);
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------
export type PaymentRow = {
  id: string; kind: "payment" | "refund"; order_id: string | null; order_number: string | null; invoice_id: string | null;
  invoice_number: string | null; method_code: string; method_name: string; amount_minor: number; status: keyof typeof PAYMENT_RECORD_STATUS;
  transaction_reference: string | null; payer_phone: string | null; has_proof: boolean; note: string | null; submitted_at: Date;
  submitter_name: string | null; verified_at: Date | null; verifier_name: string | null; decision_note: string | null;
  customer_name: string | null; due_total_minor: number | null;
};

const PAYMENT_SELECT = `
  SELECT p.id, p.kind, p.order_id, o.number AS order_number, p.invoice_id, i.number AS invoice_number, p.method_code,
         m.name AS method_name, p.amount_minor, p.status, p.transaction_reference, p.payer_phone, p.proof_path IS NOT NULL AS has_proof,
         p.note, p.submitted_at, ps.full_name AS submitter_name, p.verified_at, pv.full_name AS verifier_name, p.decision_note,
         coalesce(o.business_name, o.customer_name, i.buyer_business, i.buyer_name) AS customer_name,
         coalesce(o.total_minor, i.total_minor) AS due_total_minor
    FROM payments p
    JOIN payment_methods m ON m.code = p.method_code
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN profiles ps ON ps.user_id = p.submitted_by
    LEFT JOIN profiles pv ON pv.user_id = p.verified_by`;

export async function adminListPayments(actor: Actor | null, f: { status?: string; q?: string }) {
  assertCan(actor, "payments.view");
  const args: unknown[] = [];
  const where = ["true"];
  if (f.status && f.status in PAYMENT_RECORD_STATUS) { args.push(f.status); where.push(`p.status = $${args.length}::payment_record_status`); }
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 64).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(p.transaction_reference ILIKE $${args.length} OR o.number ILIKE $${args.length} OR i.number ILIKE $${args.length} OR o.customer_name ILIKE $${args.length})`);
  }
  return query<PaymentRow>(`${PAYMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY (p.status = 'pending_verification') DESC, p.submitted_at DESC LIMIT 200`, args);
}

export async function listPaymentsFor(actor: Actor | null, target: { orderId?: string; invoiceId?: string }) {
  assertCan(actor, "payments.view");
  return target.orderId
    ? query<PaymentRow>(`${PAYMENT_SELECT} WHERE p.order_id = $1 ORDER BY p.submitted_at`, [target.orderId])
    : query<PaymentRow>(`${PAYMENT_SELECT} WHERE p.invoice_id = $1 ORDER BY p.submitted_at`, [target.invoiceId]);
}

export async function getPaymentEvents(actor: Actor | null, paymentId: string) {
  assertCan(actor, "payments.view");
  return query<{ id: number; event: string; note: string | null; actor_name: string | null; created_at: Date }>(
    "SELECT id, event, note, actor_name, created_at FROM payment_events WHERE payment_id = $1 ORDER BY id", [paymentId],
  );
}

/** Paiements d'une commande vus par le client propriétaire (sans les notes internes). */
export async function listMyOrderPayments(actor: Actor | null, orderNumber: string) {
  if (!actor) throw new UnauthenticatedError();
  return query<{ id: string; kind: string; method_name: string; amount_minor: number; status: keyof typeof PAYMENT_RECORD_STATUS; transaction_reference: string | null; submitted_at: Date; decision_note: string | null }>(
    `SELECT p.id, p.kind, m.name AS method_name, p.amount_minor, p.status, p.transaction_reference, p.submitted_at,
            CASE WHEN p.status = 'refused' THEN p.decision_note END AS decision_note
       FROM payments p JOIN payment_methods m ON m.code = p.method_code JOIN orders o ON o.id = p.order_id
       JOIN customers c ON c.id = o.customer_id
      WHERE o.number = $1 AND c.user_id = $2 ORDER BY p.submitted_at`,
    [orderNumber, actor.id],
  );
}

/** Chemin du justificatif : personnel autorisé ou client auteur du paiement. */
export async function getProofPath(actor: Actor | null, paymentId: string) {
  if (!actor) throw new UnauthenticatedError();
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return null;
  const p = await queryOne<{ proof_path: string | null; submitted_by: string | null }>(
    "SELECT proof_path, submitted_by FROM payments WHERE id = $1", [paymentId],
  );
  if (!p?.proof_path) return null;
  if (!can(actor.roles, "payments.view") && p.submitted_by !== actor.id) throw new ForbiddenError();
  return p.proof_path;
}

export async function countPendingPayments(actor: Actor | null) {
  if (!actor || !can(actor.roles, "payments.view")) return null;
  return (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM payments WHERE status = 'pending_verification'"))!.n;
}
