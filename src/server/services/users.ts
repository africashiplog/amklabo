import { randomBytes } from "node:crypto";
import { z } from "../validation";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx } from "../db";
import { UserError } from "../errors";
import { hashPassword } from "../password";
import { ROLES, STAFF_ROLES, type Role } from "../permissions";
import { deleteUserSessions, parseRoles } from "../session";

export type UserListRow = {
  id: string; email: string; full_name: string; phone: string | null; status: "active" | "suspended" | "archived";
  roles: Role[]; created_at: Date; last_login_at: Date | null;
};

export async function adminListUsers(actor: Actor | null, f: { q?: string; scope?: "staff" | "all"; page?: number }) {
  assertCan(actor, "users.manage");
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where: string[] = ["true"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(u.email ILIKE $${args.length} OR p.full_name ILIKE $${args.length} OR p.phone ILIKE $${args.length})`);
  }
  if (f.scope !== "all") {
    args.push(STAFF_ROLES);
    where.push(`EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role = ANY($${args.length}::app_role[]))`);
  }
  const w = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u JOIN profiles p ON p.user_id = u.id WHERE ${w}`, args,
  ))!.n;
  const rows = await query<UserListRow>(
    `SELECT u.id, u.email, p.full_name, p.phone, u.status, u.created_at, u.last_login_at,
            coalesce(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE ${w}
      GROUP BY u.id, p.full_name, p.phone
      ORDER BY u.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return {
    items: rows.map((r) => ({ ...r, roles: parseRoles(r.roles) })),
    total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function countActiveAdmins(db: Parameters<typeof queryOne>[2]) {
  return (await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'admin' AND u.status = 'active'`,
    [], db,
  ))!.n;
}

/** Remplace les rôles du personnel d'un utilisateur. Les rôles clients ne sont pas modifiés ici. */
export async function setStaffRoles(actor: Actor | null, userId: string, roles: string[]) {
  assertCan(actor, "users.manage");
  const wanted = [...new Set(roles)].filter((r): r is Role => (STAFF_ROLES as string[]).includes(r));
  if (wanted.length !== new Set(roles).size) throw new UserError("Rôle invalide.");
  await tx(async (db) => {
    // Verrou sur les rôles admin pour éviter de retirer le dernier administrateur en concurrence.
    await db.query("SELECT 1 FROM user_roles WHERE role = 'admin' FOR UPDATE");
    const exists = await queryOne("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId], db);
    if (!exists) throw new UserError("Utilisateur introuvable.");
    const before = parseRoles((await queryOne<{ roles: unknown }>(
      "SELECT coalesce(array_agg(role ORDER BY role), '{}') AS roles FROM user_roles WHERE user_id = $1", [userId], db,
    ))!.roles);
    if (userId === actor.id && before.includes("admin") && !wanted.includes("admin")) {
      throw new UserError("Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
    }
    await db.query("DELETE FROM user_roles WHERE user_id = $1 AND role = ANY($2::app_role[])", [userId, STAFF_ROLES]);
    for (const role of wanted) {
      await db.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3)", [userId, role, actor.id]);
    }
    if ((await countActiveAdmins(db)) === 0) throw new UserError("Il doit rester au moins un administrateur actif.");
    const after = [...before.filter((r) => !STAFF_ROLES.includes(r)), ...wanted].sort();
    await audit(actor, "user.roles_change", "user", userId, { before: { roles: before }, after: { roles: after } }, db);
  });
}

export async function setUserStatus(actor: Actor | null, userId: string, status: "active" | "suspended") {
  assertCan(actor, "users.manage");
  if (!["active", "suspended"].includes(status)) throw new UserError("Statut invalide.");
  if (userId === actor.id) throw new UserError("Vous ne pouvez pas modifier le statut de votre propre compte.");
  await tx(async (db) => {
    await db.query("SELECT 1 FROM user_roles WHERE role = 'admin' FOR UPDATE");
    const before = await queryOne<{ status: string }>("SELECT status FROM users WHERE id = $1 FOR UPDATE", [userId], db);
    if (!before) throw new UserError("Utilisateur introuvable.");
    if (before.status === "archived") throw new UserError("Ce compte est archivé.");
    await db.query("UPDATE users SET status = $2 WHERE id = $1", [userId, status]);
    await db.query("UPDATE customers SET status = $2 WHERE user_id = $1", [userId, status]);
    if (status === "suspended") await deleteUserSessions(userId, db);
    if ((await countActiveAdmins(db)) === 0) throw new UserError("Il doit rester au moins un administrateur actif.");
    await audit(actor, status === "suspended" ? "user.suspend" : "user.activate", "user", userId,
      { before, after: { status } }, db);
  });
}

export const staffSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(200),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  roles: z.array(z.enum(ROLES)).min(1, "Choisissez au moins un rôle"),
});

/**
 * Crée un compte du personnel avec un mot de passe temporaire, affiché une
 * seule fois à l'administrateur (aucun service d'e-mail n'est encore configuré).
 */
export async function createStaffUser(actor: Actor | null, input: z.input<typeof staffSchema>) {
  assertCan(actor, "users.manage");
  const d = staffSchema.parse(input);
  if (d.roles.some((r) => !STAFF_ROLES.includes(r))) throw new UserError("Seuls les rôles du personnel sont autorisés ici.");
  const tempPassword = randomBytes(9).toString("base64url");
  const hash = await hashPassword(tempPassword);
  try {
    const userId = await tx(async (db) => {
      const u = await queryOne<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", [d.email, hash], db);
      await db.query("INSERT INTO profiles (user_id, full_name, phone) VALUES ($1, $2, $3)", [u!.id, d.fullName, d.phone]);
      for (const role of d.roles) {
        await db.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3)", [u!.id, role, actor.id]);
      }
      await audit(actor, "user.create_staff", "user", u!.id, { after: { email: d.email, roles: d.roles } }, db);
      return u!.id;
    });
    return { userId, tempPassword };
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Un compte existe déjà avec cette adresse.", { email: "Adresse déjà utilisée" });
    throw err;
  }
}

/**
 * Réinitialisation par un administrateur (aucun e-mail n'est configuré) :
 * mot de passe temporaire affiché une seule fois, sessions fermées.
 */
export async function resetUserPassword(actor: Actor | null, userId: string) {
  assertCan(actor, "users.manage");
  if (userId === actor.id) throw new UserError("Utilisez « Mon compte » pour changer votre propre mot de passe.");
  const tempPassword = randomBytes(9).toString("base64url");
  const hash = await hashPassword(tempPassword);
  await tx(async (db) => {
    const u = await queryOne<{ status: string }>("SELECT status FROM users WHERE id = $1 FOR UPDATE", [userId], db);
    if (!u) throw new UserError("Utilisateur introuvable.");
    if (u.status === "archived") throw new UserError("Ce compte est archivé.");
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, hash]);
    await deleteUserSessions(userId, db);
    await audit(actor, "user.password_reset", "user", userId, {}, db);
  });
  return tempPassword;
}
