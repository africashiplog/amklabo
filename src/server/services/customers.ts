import { assertCan, type Actor } from "../actor";
import { query, queryOne } from "../db";

export type CustomerRow = {
  id: string; full_name: string; email: string | null; phone: string | null; customer_type: "retail" | "business";
  status: "active" | "suspended" | "archived"; created_at: Date; has_account: boolean; address_count: number;
};

export async function adminListCustomers(actor: Actor | null, f: { q?: string; type?: string; page?: number }) {
  assertCan(actor, "customers.read");
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where: string[] = ["true"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(c.full_name ILIKE $${args.length} OR c.email ILIKE $${args.length} OR c.phone ILIKE $${args.length})`);
  }
  if (f.type === "retail" || f.type === "business") {
    args.push(f.type);
    where.push(`c.customer_type = $${args.length}`);
  }
  const w = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM customers c WHERE ${w}`, args))!.n;
  const items = await query<CustomerRow>(
    `SELECT c.id, c.full_name, c.email, c.phone, c.customer_type, c.status, c.created_at,
            c.user_id IS NOT NULL AS has_account,
            (SELECT count(*)::int FROM addresses a WHERE a.customer_id = c.id) AS address_count
       FROM customers c WHERE ${w}
      ORDER BY c.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
