import { assertCan, type Actor } from "../actor";
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
