import type { Actor } from "./actor";
import { pool, type Db } from "./db";

export async function audit(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  data: { before?: unknown; after?: unknown } = {},
  db: Db = pool(),
) {
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_data, after_data, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      action,
      entityType,
      entityId,
      data.before === undefined ? null : JSON.stringify(data.before),
      data.after === undefined ? null : JSON.stringify(data.after),
      actor?.ip ?? null,
    ],
  );
}
