import { createHash, randomBytes } from "node:crypto";
import type { Actor } from "./actor";
import type { Role } from "./permissions";
import { pool, query, queryOne, type Db } from "./db";

export const SESSION_COOKIE = "amk_session";
export const SESSION_TTL_DAYS = 14;

const hashToken = (token: string) => createHash("sha256").update(token).digest();

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  db: Db = pool(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)",
    [hashToken(token), userId, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
  );
  return { token, expiresAt };
}

/** Retourne l'utilisateur d'une session valide et d'un compte actif, sinon null. */
export async function getSessionActor(token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  const row = await queryOne<{ id: string; email: string; full_name: string; roles: Role[] }>(
    `SELECT u.id, u.email, p.full_name,
            coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
      GROUP BY u.id, p.full_name`,
    [hashToken(token)],
  );
  if (!row) return null;
  return { id: row.id, email: row.email, fullName: row.full_name, roles: parseRoles(row.roles) };
}

export async function deleteSession(token: string) {
  await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function deleteUserSessions(userId: string, db: Db = pool()) {
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

// node-postgres renvoie les tableaux d'enum sous forme de texte "{a,b}".
export function parseRoles(value: unknown): Role[] {
  if (Array.isArray(value)) return value as Role[];
  if (typeof value === "string") {
    const inner = value.replace(/^\{|\}$/g, "");
    return inner ? (inner.split(",") as Role[]) : [];
  }
  return [];
}
