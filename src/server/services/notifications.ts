import type { Actor } from "../actor";
import { pool, query, queryOne, type Db } from "../db";
import { UnauthenticatedError } from "../errors";

/**
 * Notifications internes, affichées dans l'espace client. Aucun service
 * d'e-mail ou de SMS n'est configuré : ce canal est le seul actif.
 */
export async function notify(db: Db, userId: string | null, title: string, body: string | null, link: string | null) {
  if (!userId) return; // client sans compte en ligne
  await db.query("INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, $4)", [userId, title, body, link]);
}

export type Notification = { id: number; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date };

export async function listMyNotifications(actor: Actor | null) {
  if (!actor) throw new UnauthenticatedError();
  return query<Notification>("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [actor.id]);
}

export async function unreadCount(actor: Actor | null) {
  if (!actor) return 0;
  return (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [actor.id]))!.n;
}

export async function markAllRead(actor: Actor | null) {
  if (!actor) throw new UnauthenticatedError();
  await pool().query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [actor.id]);
}
