import { z } from "../validation";
import type { Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx, type Db } from "../db";
import { UnauthenticatedError, UserError } from "../errors";
import { hashPassword, verifyPassword } from "../password";
import { deleteUserSessions } from "../session";

const phone = z.string().trim().regex(/^\+?[0-9 ]{8,20}$/, "Numéro de téléphone invalide");

function requireActor(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
}

/** Fiche client liée au compte connecté (toujours filtrée par user_id). */
async function myCustomerId(actor: Actor, db?: Db): Promise<string> {
  const row = await queryOne<{ id: string }>("SELECT id FROM customers WHERE user_id = $1", [actor.id], db);
  if (!row) throw new UserError("Aucune fiche client n'est associée à ce compte.");
  return row.id;
}

export async function getMyProfile(actor: Actor | null) {
  requireActor(actor);
  return queryOne<{ full_name: string; phone: string | null; email: string; customer_type: string | null; created_at: Date }>(
    `SELECT p.full_name, p.phone, u.email, c.customer_type, u.created_at
       FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN customers c ON c.user_id = u.id
      WHERE u.id = $1`,
    [actor.id],
  );
}

export const profileSchema = z.object({ fullName: z.string().trim().min(2).max(120), phone });

export async function updateMyProfile(actor: Actor | null, input: z.input<typeof profileSchema>) {
  requireActor(actor);
  const d = profileSchema.parse(input);
  await tx(async (db) => {
    const before = await queryOne("SELECT full_name, phone FROM profiles WHERE user_id = $1", [actor.id], db);
    await db.query("UPDATE profiles SET full_name = $2, phone = $3 WHERE user_id = $1", [actor.id, d.fullName, d.phone]);
    await db.query("UPDATE customers SET full_name = $2, phone = $3 WHERE user_id = $1", [actor.id, d.fullName, d.phone]);
    await audit(actor, "profile.update", "user", actor.id, { before, after: d }, db);
  });
}

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1, "Mot de passe actuel requis"),
    next: z.string().min(10, "Au moins 10 caractères").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { message: "Les mots de passe ne correspondent pas", path: ["confirm"] });

/** Change le mot de passe et ferme toutes les sessions ; retourne true si réussi. */
export async function changeMyPassword(actor: Actor | null, input: z.input<typeof passwordChangeSchema>) {
  requireActor(actor);
  const d = passwordChangeSchema.parse(input);
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [actor.id]);
  if (!row || !(await verifyPassword(d.current, row.password_hash))) {
    throw new UserError("Mot de passe actuel incorrect.", { current: "Incorrect" });
  }
  const hash = await hashPassword(d.next);
  await tx(async (db) => {
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [actor.id, hash]);
    await deleteUserSessions(actor.id, db);
    await audit(actor, "account.password_change", "user", actor.id, {}, db);
  });
}

// ---------------------------------------------------------------------------
// Adresses
// ---------------------------------------------------------------------------
export type Address = {
  id: string; label: string; recipient: string; phone: string; city: string; district: string | null;
  line1: string; landmark: string | null; zone_id: string | null; zone_name: string | null; is_default: boolean;
};

export async function listMyAddresses(actor: Actor | null) {
  requireActor(actor);
  return query<Address>(
    `SELECT a.*, z.name AS zone_name FROM addresses a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN delivery_zones z ON z.id = a.zone_id
      WHERE c.user_id = $1
      ORDER BY a.is_default DESC, a.created_at`,
    [actor.id],
  );
}

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(60),
  recipient: z.string().trim().min(2, "Nom du destinataire requis").max(120),
  phone,
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().max(80).optional().transform((v) => v || null),
  line1: z.string().trim().min(3, "Adresse requise").max(300),
  landmark: z.string().trim().max(300).optional().transform((v) => v || null),
  zoneId: z.string().uuid().nullable(),
  isDefault: z.boolean(),
});

export const MAX_ADDRESSES = 10;

export async function saveMyAddress(actor: Actor | null, id: string | null, input: z.input<typeof addressSchema>) {
  requireActor(actor);
  const d = addressSchema.parse(input);
  await tx(async (db) => {
    const customerId = await myCustomerId(actor, db);
    if (d.zoneId) {
      const zone = await queryOne("SELECT 1 FROM delivery_zones WHERE id = $1 AND is_active", [d.zoneId], db);
      if (!zone) throw new UserError("Zone de livraison indisponible.", { zoneId: "Zone indisponible" });
    }
    if (d.isDefault) await db.query("UPDATE addresses SET is_default = false WHERE customer_id = $1", [customerId]);
    const values = [d.label, d.recipient, d.phone, d.city, d.district, d.line1, d.landmark, d.zoneId, d.isDefault];
    if (id) {
      const res = await db.query(
        `UPDATE addresses SET label=$1, recipient=$2, phone=$3, city=$4, district=$5, line1=$6, landmark=$7, zone_id=$8, is_default=$9
          WHERE id = $10 AND customer_id = $11`,
        [...values, id, customerId],
      );
      if (res.rowCount === 0) throw new UserError("Adresse introuvable.");
    } else {
      const n = (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM addresses WHERE customer_id = $1", [customerId], db))!.n;
      if (n >= MAX_ADDRESSES) throw new UserError(`Maximum ${MAX_ADDRESSES} adresses.`);
      await db.query(
        `INSERT INTO addresses (label, recipient, phone, city, district, line1, landmark, zone_id, is_default, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9 OR NOT EXISTS (SELECT 1 FROM addresses WHERE customer_id = $10), $10)`,
        [...values, customerId],
      );
    }
  });
}

export async function deleteMyAddress(actor: Actor | null, id: string) {
  requireActor(actor);
  const res = await query(
    `DELETE FROM addresses a USING customers c
      WHERE a.id = $1 AND a.customer_id = c.id AND c.user_id = $2 RETURNING a.id`,
    [id, actor.id],
  );
  if (res.length === 0) throw new UserError("Adresse introuvable.");
}

