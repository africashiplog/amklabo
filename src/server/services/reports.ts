/**
 * Rapports — calculés en direct à partir de la base, jamais de chiffres statiques.
 *
 * Définitions (affichées dans l'interface) :
 *  - « Ventes » : commandes passées sur la période, hors commandes annulées ou retournées,
 *    montants TTC tels que payés par le client (livraison incluse dans le total commande).
 *  - « Chiffre d'affaires facturé » : factures émises moins avoirs émis, par date d'émission.
 *  - Ni l'un ni l'autre n'est un bénéfice : aucun calcul de marge n'est fait.
 *  - Ventes par catégorie : catégorie ACTUELLE du produit (non historisée).
 *  - Solde client : somme des restes à payer de ses factures émises (avoirs et règlements déduits).
 */
import { assertCan, type Actor } from "../actor";
import { query } from "../db";
import { UserError } from "../errors";
import { can } from "../permissions";

export type Range = { from: string; to: string };
export type Grain = "day" | "week" | "month";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Valide une période (bornes incluses, 3 ans maximum). */
export function parseRange(from?: string, to?: string): Range {
  const today = new Date().toISOString().slice(0, 10);
  const t = to && DATE.test(to) ? to : today;
  const f = from && DATE.test(from) ? from : new Date(Date.parse(`${t}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (f > t) throw new UserError("La date de début doit précéder la date de fin.");
  if (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`) > 3 * 366 * 86_400_000) throw new UserError("Période limitée à 3 ans.");
  return { from: f, to: t };
}

// Commandes comptées comme ventes. Fuseau : Africa/Nouakchott = UTC.
const SOLD = "o.status NOT IN ('cancelled', 'returned') AND o.placed_at >= $1::date AND o.placed_at < $2::date + 1";

function assertReports(actor: Actor | null): asserts actor is Actor {
  assertCan(actor, "reports.view");
}

export type PeriodRow = {
  period: string; orders: number; total_minor: number; retail_orders: number; retail_minor: number;
  business_orders: number; business_minor: number; invoiced_minor: number; credited_minor: number;
};

export async function salesByPeriod(actor: Actor | null, r: Range, grain: Grain) {
  assertReports(actor);
  const g = (["day", "week", "month"] as const).includes(grain) ? grain : "day";
  const step = g === "day" ? "1 day" : g === "week" ? "1 week" : "1 month";
  // Série continue de périodes (les périodes sans vente apparaissent à zéro).
  return query<PeriodRow>(
    `WITH periods AS (
       SELECT generate_series(date_trunc('${g}', $1::date), date_trunc('${g}', $2::date), interval '${step}')::date AS period
     ), sales AS (
       SELECT date_trunc('${g}', o.placed_at AT TIME ZONE 'UTC')::date AS period,
              count(*)::int AS orders, sum(o.total_minor)::bigint AS total_minor,
              count(*) FILTER (WHERE o.customer_type = 'retail')::int AS retail_orders,
              coalesce(sum(o.total_minor) FILTER (WHERE o.customer_type = 'retail'), 0)::bigint AS retail_minor,
              count(*) FILTER (WHERE o.customer_type = 'business')::int AS business_orders,
              coalesce(sum(o.total_minor) FILTER (WHERE o.customer_type = 'business'), 0)::bigint AS business_minor
         FROM orders o WHERE ${SOLD} GROUP BY 1
     ), billed AS (
       SELECT date_trunc('${g}', issue_date)::date AS period,
              coalesce(sum(total_minor) FILTER (WHERE kind = 'invoice'), 0)::bigint AS invoiced_minor,
              coalesce(sum(total_minor) FILTER (WHERE kind = 'credit_note'), 0)::bigint AS credited_minor
         FROM invoices WHERE status = 'issued' AND issue_date BETWEEN $1::date AND $2::date GROUP BY 1
     )
     SELECT to_char(p.period, 'YYYY-MM-DD') AS period,
            coalesce(s.orders, 0) AS orders, coalesce(s.total_minor, 0)::bigint AS total_minor,
            coalesce(s.retail_orders, 0) AS retail_orders, coalesce(s.retail_minor, 0)::bigint AS retail_minor,
            coalesce(s.business_orders, 0) AS business_orders, coalesce(s.business_minor, 0)::bigint AS business_minor,
            coalesce(b.invoiced_minor, 0)::bigint AS invoiced_minor, coalesce(b.credited_minor, 0)::bigint AS credited_minor
       FROM periods p LEFT JOIN sales s USING (period) LEFT JOIN billed b USING (period)
      ORDER BY p.period`,
    [r.from, r.to],
  );
}

export type ProductSalesRow = {
  product_id: string; sku: string; name: string; category_name: string | null; quantity: number; orders: number;
  revenue_minor: number; retail_revenue_minor: number; business_revenue_minor: number;
};

export async function salesByProduct(actor: Actor | null, r: Range, sort: "revenue" | "quantity" = "revenue", limit = 100) {
  assertReports(actor);
  const order = sort === "quantity" ? "quantity DESC, revenue_minor DESC" : "revenue_minor DESC, quantity DESC";
  return query<ProductSalesRow>(
    `SELECT i.product_id, i.sku, i.name, c.name AS category_name,
            sum(i.quantity)::int AS quantity, count(DISTINCT o.id)::int AS orders, sum(i.line_total_minor)::bigint AS revenue_minor,
            coalesce(sum(i.line_total_minor) FILTER (WHERE o.customer_type = 'retail'), 0)::bigint AS retail_revenue_minor,
            coalesce(sum(i.line_total_minor) FILTER (WHERE o.customer_type = 'business'), 0)::bigint AS business_revenue_minor
       FROM order_items i JOIN orders o ON o.id = i.order_id
       JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${SOLD}
      GROUP BY i.product_id, i.sku, i.name, c.name
      ORDER BY ${order} LIMIT ${Math.min(Math.max(limit, 1), 1000)}`,
    [r.from, r.to],
  );
}

export async function salesByCategory(actor: Actor | null, r: Range) {
  assertReports(actor);
  return query<{ category_name: string; quantity: number; orders: number; revenue_minor: number }>(
    `SELECT coalesce(c.name, 'Sans catégorie') AS category_name, sum(i.quantity)::int AS quantity,
            count(DISTINCT o.id)::int AS orders, sum(i.line_total_minor)::bigint AS revenue_minor
       FROM order_items i JOIN orders o ON o.id = i.order_id
       JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${SOLD}
      GROUP BY 1 ORDER BY revenue_minor DESC`,
    [r.from, r.to],
  );
}

export type StockReportRow = {
  sku: string; name: string; status: string; physical: number; reserved: number; available: number;
  threshold: number; expired: number; next_expiry: string | null; state: "rupture" | "bas" | "ok";
};

/** État du stock à l'instant présent (pas de période). */
export async function stockReport(actor: Actor | null) {
  if (!actor || !(can(actor.roles, "reports.view") || can(actor.roles, "stock.manage"))) assertCan(actor, "reports.view");
  return query<StockReportRow>(
    `SELECT * FROM (
       SELECT p.sku, p.name, p.status,
              coalesce(sum(l.qty_on_hand) FILTER (WHERE l.expiry_date IS NULL OR l.expiry_date >= current_date), 0)::int AS physical,
              coalesce(sum(l.qty_reserved), 0)::int AS reserved,
              coalesce(sum(l.qty_on_hand - l.qty_reserved) FILTER (WHERE l.expiry_date IS NULL OR l.expiry_date >= current_date), 0)::int AS available,
              p.stock_alert_threshold AS threshold,
              coalesce(sum(l.qty_on_hand) FILTER (WHERE l.expiry_date < current_date), 0)::int AS expired,
              to_char(min(l.expiry_date) FILTER (WHERE l.qty_on_hand > 0 AND l.expiry_date >= current_date), 'YYYY-MM-DD') AS next_expiry
         FROM products p LEFT JOIN stock_lots l ON l.product_id = p.id
        WHERE p.status <> 'archived'
        GROUP BY p.id
     ) s
     CROSS JOIN LATERAL (SELECT CASE WHEN s.available = 0 THEN 'rupture' WHEN s.available <= s.threshold THEN 'bas' ELSE 'ok' END AS state) st
     ORDER BY st.state = 'ok', s.available, s.name`,
  );
}

export async function expiringLotsReport(actor: Actor | null, days: number) {
  if (!actor || !(can(actor.roles, "reports.view") || can(actor.roles, "stock.manage"))) assertCan(actor, "reports.view");
  const d = Math.min(Math.max(Math.trunc(days) || 90, 1), 730);
  return query<{ sku: string; name: string; lot_number: string | null; expiry_date: string; qty_on_hand: number; qty_reserved: number; days_left: number }>(
    `SELECT p.sku, p.name, l.lot_number, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date, l.qty_on_hand, l.qty_reserved,
            (l.expiry_date - current_date) AS days_left
       FROM stock_lots l JOIN products p ON p.id = l.product_id
      WHERE l.qty_on_hand > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= current_date + $1::int
      ORDER BY l.expiry_date, p.name`,
    [d],
  );
}

export async function cancellationsReport(actor: Actor | null, r: Range) {
  assertReports(actor);
  const cancelled = await query<{ number: string; placed_at: Date; cancelled_at: Date; customer: string; total_minor: number; reason: string | null }>(
    `SELECT o.number, o.placed_at, o.cancelled_at, coalesce(o.business_name, o.customer_name) AS customer, o.total_minor, o.cancel_reason AS reason
       FROM orders o WHERE o.status = 'cancelled' AND o.cancelled_at >= $1::date AND o.cancelled_at < $2::date + 1
      ORDER BY o.cancelled_at DESC`,
    [r.from, r.to],
  );
  const returns = await query<{ number: string; requested_at: Date; status: string; customer: string; total_minor: number; reason: string; restocked: boolean | null }>(
    `SELECT o.number, rt.requested_at, rt.status, coalesce(o.business_name, o.customer_name) AS customer, o.total_minor, rt.reason, rt.restocked
       FROM returns rt JOIN orders o ON o.id = rt.order_id
      WHERE rt.requested_at >= $1::date AND rt.requested_at < $2::date + 1 ORDER BY rt.requested_at DESC`,
    [r.from, r.to],
  );
  return { cancelled, returns };
}

export async function paymentsReport(actor: Actor | null, r: Range) {
  assertReports(actor);
  const byMethod = await query<{ method: string; confirmed_count: number; confirmed_minor: number; refunded_minor: number; pending_count: number; pending_minor: number; refused_count: number }>(
    `SELECT m.name AS method,
            count(p.*) FILTER (WHERE p.kind = 'payment' AND p.status = 'confirmed' AND p.verified_at >= $1::date AND p.verified_at < $2::date + 1)::int AS confirmed_count,
            coalesce(sum(p.amount_minor) FILTER (WHERE p.kind = 'payment' AND p.status = 'confirmed' AND p.verified_at >= $1::date AND p.verified_at < $2::date + 1), 0)::bigint AS confirmed_minor,
            coalesce(sum(p.amount_minor) FILTER (WHERE p.kind = 'refund' AND p.verified_at >= $1::date AND p.verified_at < $2::date + 1), 0)::bigint AS refunded_minor,
            count(p.*) FILTER (WHERE p.status = 'pending_verification')::int AS pending_count,
            coalesce(sum(p.amount_minor) FILTER (WHERE p.status = 'pending_verification'), 0)::bigint AS pending_minor,
            count(p.*) FILTER (WHERE p.status = 'refused' AND p.verified_at >= $1::date AND p.verified_at < $2::date + 1)::int AS refused_count
       FROM payment_methods m LEFT JOIN payments p ON p.method_code = m.code
      GROUP BY m.code, m.name, m.sort_order ORDER BY m.sort_order`,
    [r.from, r.to],
  );
  const pending = await query<{ submitted_at: Date; method: string; amount_minor: number; reference: string | null; document: string | null }>(
    `SELECT p.submitted_at, m.name AS method, p.amount_minor, p.transaction_reference AS reference, coalesce(o.number, i.number) AS document
       FROM payments p JOIN payment_methods m ON m.code = p.method_code
       LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status = 'pending_verification' ORDER BY p.submitted_at`,
  );
  return { byMethod, pending };
}

export type UnpaidRow = {
  number: string; issue_date: string; due_date: string | null; customer: string; total_minor: number; credited_minor: number;
  paid_minor: number; balance_minor: number; days_overdue: number | null;
};

/** Factures émises non soldées (à date) et soldes par client. */
export async function unpaidInvoicesReport(actor: Actor | null) {
  if (!actor || !(can(actor.roles, "reports.view") || can(actor.roles, "invoices.read"))) assertCan(actor, "reports.view");
  const invoices = await query<UnpaidRow>(
    `WITH x AS (
       SELECT i.number, to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
              coalesce(i.buyer_business, i.buyer_name) AS customer, i.customer_id, i.total_minor,
              coalesce((SELECT sum(cn.total_minor) FROM invoices cn WHERE cn.credited_invoice_id = i.id AND cn.status = 'issued'), 0)::bigint AS credited_minor,
              i.amount_paid_minor AS paid_minor,
              CASE WHEN i.due_date < current_date THEN current_date - i.due_date END AS days_overdue
         FROM invoices i WHERE i.kind = 'invoice' AND i.status = 'issued')
     SELECT *, greatest(total_minor - credited_minor - paid_minor, 0)::bigint AS balance_minor FROM x
      WHERE total_minor - credited_minor - paid_minor > 0 ORDER BY days_overdue DESC NULLS LAST, issue_date`,
  );
  const byCustomer = new Map<string, { customer: string; count: number; balance_minor: number }>();
  for (const inv of invoices) {
    const cur = byCustomer.get(inv.customer) ?? { customer: inv.customer, count: 0, balance_minor: 0 };
    cur.count += 1;
    cur.balance_minor += inv.balance_minor;
    byCustomer.set(inv.customer, cur);
  }
  return { invoices, balances: [...byCustomer.values()].sort((a, b) => b.balance_minor - a.balance_minor) };
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------
/** Montant pour tableur français : « 1250,50 ». */
export const csvMoney = (minor: number) => {
  const neg = minor < 0;
  const a = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(a / 100)},${String(a % 100).padStart(2, "0")}`;
};

/**
 * CSV séparé par « ; » (Excel en français), encodé UTF-8 avec BOM.
 * Les cellules commençant par = + - @ (ou tabulation) sont neutralisées
 * pour empêcher l'injection de formules.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
