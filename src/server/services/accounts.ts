import { z } from "../validation";
import { audit } from "../audit";
import { pgCode, queryOne, tx, query } from "../db";
import { UserError } from "../errors";
import { getDummyHash, hashPassword, verifyPassword } from "../password";
import { createSession } from "../session";

export const MAX_FAILED_PER_EMAIL = 5;
export const MAX_FAILED_PER_IP = 20;
export const LOCK_WINDOW_MINUTES = 15;

const phoneRegex = /^\+?[0-9 ]{8,20}$/;

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court").max(120),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(200),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Numéro de téléphone invalide (ex. +222 22 12 34 56)"),
  password: z.string().min(10, "Le mot de passe doit contenir au moins 10 caractères").max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export async function registerCustomer(input: RegisterInput, meta: { ip?: string | null } = {}) {
  const data = registerSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  try {
    return await tx(async (db) => {
      const user = await queryOne<{ id: string }>(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [data.email, passwordHash],
        db,
      );
      const userId = user!.id;
      await db.query("INSERT INTO profiles (user_id, full_name, phone) VALUES ($1, $2, $3)", [
        userId, data.fullName, data.phone,
      ]);
      await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer_retail')", [userId]);
      await db.query(
        "INSERT INTO customers (user_id, customer_type, full_name, email, phone) VALUES ($1, 'retail', $2, $3, $4)",
        [userId, data.fullName, data.email, data.phone],
      );
      await audit(
        { id: userId, email: data.email, fullName: data.fullName, roles: [], ip: meta.ip },
        "account.register", "user", userId, {}, db,
      );
      return { userId };
    });
  } catch (err) {
    if (pgCode(err) === "23505") {
      throw new UserError("Un compte existe déjà avec cette adresse e-mail.", { email: "Adresse déjà utilisée" });
    }
    throw err;
  }
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(200),
  password: z.string().min(1, "Mot de passe requis").max(200),
});

export async function isLockedOut(email: string, ip: string | null): Promise<boolean> {
  const row = await queryOne<{ by_email: number; by_ip: number }>(
    `SELECT
       count(*) FILTER (WHERE email = $1)::int AS by_email,
       count(*) FILTER (WHERE $2::inet IS NOT NULL AND ip = $2::inet)::int AS by_ip
     FROM login_attempts
     WHERE NOT succeeded AND created_at > now() - make_interval(mins => $3)`,
    [email, ip, LOCK_WINDOW_MINUTES],
  );
  return (row?.by_email ?? 0) >= MAX_FAILED_PER_EMAIL || (row?.by_ip ?? 0) >= MAX_FAILED_PER_IP;
}

const GENERIC_LOGIN_ERROR = "Adresse e-mail ou mot de passe incorrect.";

export async function login(
  input: { email: string; password: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new UserError(GENERIC_LOGIN_ERROR);
  const { email, password } = parsed.data;
  const ip = meta.ip ?? null;

  if (await isLockedOut(email, ip)) {
    throw new UserError(`Trop de tentatives échouées. Réessayez dans ${LOCK_WINDOW_MINUTES} minutes.`);
  }

  const user = await queryOne<{ id: string; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE email = $1",
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  await query("INSERT INTO login_attempts (email, ip, succeeded) VALUES ($1, $2, $3)", [email, ip, ok && !!user]);

  if (!user || !ok) throw new UserError(GENERIC_LOGIN_ERROR);
  if (user.status !== "active") throw new UserError("Ce compte est suspendu. Contactez AMKLABO.");

  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  const session = await createSession(user.id, meta);
  return { userId: user.id, ...session };
}
