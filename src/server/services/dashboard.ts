import { assertCan, type Actor } from "../actor";
import { can } from "../permissions";
import { query, queryOne } from "../db";

/** Indicateurs calculés en direct à partir de la base de données. */
export async function getDashboardStats(actor: Actor | null) {
  assertCan(actor, "dashboard.view");
  const counts = await queryOne<{
    products_total: number; products_published: number; products_draft: number; products_unavailable: number;
    products_archived: number; products_without_image: number; categories_active: number; categories_total: number;
    customers_total: number; customers_30d: number; messages_open: number; zones_active: number;
    business_pending: number; business_approved: number; purchases_open: number;
  }>(`SELECT
      (SELECT count(*)::int FROM products) AS products_total,
      (SELECT count(*)::int FROM products WHERE status = 'published') AS products_published,
      (SELECT count(*)::int FROM products WHERE status = 'draft') AS products_draft,
      (SELECT count(*)::int FROM products WHERE status = 'unavailable') AS products_unavailable,
      (SELECT count(*)::int FROM products WHERE status = 'archived') AS products_archived,
      (SELECT count(*)::int FROM products p WHERE status = 'published'
          AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)) AS products_without_image,
      (SELECT count(*)::int FROM categories WHERE is_active) AS categories_active,
      (SELECT count(*)::int FROM categories) AS categories_total,
      (SELECT count(*)::int FROM customers) AS customers_total,
      (SELECT count(*)::int FROM customers WHERE created_at > now() - interval '30 days') AS customers_30d,
      (SELECT count(*)::int FROM contact_messages WHERE handled_at IS NULL) AS messages_open,
      (SELECT count(*)::int FROM delivery_zones WHERE is_active) AS zones_active,
      (SELECT count(*)::int FROM business_accounts WHERE status = 'pending') AS business_pending,
      (SELECT count(*)::int FROM business_accounts WHERE status = 'approved') AS business_approved,
      (SELECT count(*)::int FROM purchase_orders WHERE status IN ('ordered', 'partially_received')) AS purchases_open`);

  const recentCustomers = await query<{ id: string; full_name: string; customer_type: string; created_at: Date }>(
    "SELECT id, full_name, customer_type, created_at FROM customers ORDER BY created_at DESC LIMIT 5",
  );
  const recentActivity = await query<{ id: number; action: string; actor_email: string | null; created_at: Date; entity_type: string }>(
    "SELECT id, action, actor_email, created_at, entity_type FROM audit_logs ORDER BY created_at DESC LIMIT 8",
  );
  return { counts: counts!, recentCustomers, recentActivity };
}

export type AuditRow = {
  id: number; actor_email: string | null; action: string; entity_type: string; entity_id: string | null;
  before_data: unknown; after_data: unknown; ip: string | null; created_at: Date;
};

export async function listAuditLogs(actor: Actor | null, f: { action?: string; entity?: string; page?: number }) {
  assertCan(actor, "audit.read");
  const pageSize = 50;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where: string[] = ["true"];
  if (f.action?.trim()) {
    args.push(`${f.action.trim().slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`action ILIKE $${args.length}`);
  }
  if (f.entity?.trim()) {
    args.push(f.entity.trim().slice(0, 100));
    where.push(`entity_id = $${args.length}`);
  }
  const w = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE ${w}`, args))!.n;
  const items = await query<AuditRow>(
    `SELECT id, actor_email, action, entity_type, entity_id, before_data, after_data, host(ip) AS ip, created_at
       FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export const PERIODS = { "7": "7 derniers jours", "30": "30 derniers jours", "90": "90 derniers jours", "365": "12 derniers mois" } as const;

/**
 * Chiffre d'affaires facturé (factures émises moins avoirs émis, par date
 * d'émission) et activité commerciale sur la période. Ce n'est pas un bénéfice.
 */
export async function getSalesStats(actor: Actor | null, days: number) {
  assertCan(actor, "dashboard.view");
  const d = [7, 30, 90, 365].includes(days) ? days : 30;
  const revenue = can(actor.roles, "reports.view") || can(actor.roles, "invoices.read")
    ? (await queryOne<{ invoiced: number; credited: number; unpaid_count: number; unpaid_minor: number }>(
        `SELECT
           coalesce(sum(total_minor) FILTER (WHERE kind = 'invoice' AND issue_date > current_date - $1::int), 0)::bigint AS invoiced,
           coalesce(sum(total_minor) FILTER (WHERE kind = 'credit_note' AND issue_date > current_date - $1::int), 0)::bigint AS credited,
           count(*) FILTER (WHERE kind = 'invoice' AND amount_paid_minor < total_minor
             - coalesce((SELECT sum(cn.total_minor) FROM invoices cn WHERE cn.credited_invoice_id = invoices.id AND cn.status = 'issued'), 0))::int AS unpaid_count,
           coalesce(sum(total_minor - amount_paid_minor
             - coalesce((SELECT sum(cn.total_minor) FROM invoices cn WHERE cn.credited_invoice_id = invoices.id AND cn.status = 'issued'), 0))
             FILTER (WHERE kind = 'invoice'), 0)::bigint AS unpaid_minor
           FROM invoices WHERE status = 'issued'`,
        [d],
      ))!
    : null;
  const orders = (await queryOne<{ total: number; retail: number; business: number; retail_minor: number; business_minor: number; to_process: number; cancel_requests: number; returns_open: number }>(
    `SELECT
       count(*) FILTER (WHERE placed_at > now() - make_interval(days => $1) AND status <> 'cancelled')::int AS total,
       count(*) FILTER (WHERE placed_at > now() - make_interval(days => $1) AND status <> 'cancelled' AND customer_type = 'retail')::int AS retail,
       count(*) FILTER (WHERE placed_at > now() - make_interval(days => $1) AND status <> 'cancelled' AND customer_type = 'business')::int AS business,
       coalesce(sum(total_minor) FILTER (WHERE placed_at > now() - make_interval(days => $1) AND status NOT IN ('cancelled', 'returned') AND customer_type = 'retail'), 0)::bigint AS retail_minor,
       coalesce(sum(total_minor) FILTER (WHERE placed_at > now() - make_interval(days => $1) AND status NOT IN ('cancelled', 'returned') AND customer_type = 'business'), 0)::bigint AS business_minor,
       count(*) FILTER (WHERE status IN ('new', 'pending_confirmation', 'confirmed', 'preparing', 'ready_to_ship'))::int AS to_process,
       count(*) FILTER (WHERE cancel_requested_at IS NOT NULL)::int AS cancel_requests,
       (SELECT count(*)::int FROM returns WHERE status IN ('requested', 'accepted')) AS returns_open
     FROM orders`,
    [d],
  ))!;
  const latest = await query<{ id: string; number: string; customer_name: string; business_name: string | null; total_minor: number; status: string; placed_at: Date }>(
    "SELECT id, number, customer_name, business_name, total_minor, status, placed_at FROM orders ORDER BY placed_at DESC LIMIT 6",
  );
  return { days: d, revenue, orders, latest };
}
