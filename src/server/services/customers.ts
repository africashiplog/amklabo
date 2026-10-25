import { randomBytes } from "node:crypto";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx } from "../db";
import { UserError } from "../errors";
import { hashPassword } from "../password";
import { STAFF_ROLES } from "../permissions";
import { deleteUserSessions } from "../session";
import { z } from "../validation";

export type CustomerRow = {
  id: string; full_name: string; email: string | null; phone: string | null; customer_type: "retail" | "business";
  status: "active" | "suspended" | "archived"; created_at: Date; has_account: boolean; address_count: number;
  business_status: string | null;
};

export async function adminListCustomers(actor: Actor | null, f: { q?: string; type?: string; status?: string; page?: number }) {
  assertCan(actor, "customers.read");
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where: string[] = ["true"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(c.full_name ILIKE $${args.length} OR c.email ILIKE $${args.length} OR c.phone ILIKE $${args.length}
                 OR b.establishment_name ILIKE $${args.length})`);
  }
  if (f.type === "retail" || f.type === "business") {
    args.push(f.type);
    where.push(`c.customer_type = $${args.length}`);
  }
  if (f.status === "active" || f.status === "suspended" || f.status === "archived") {
    args.push(f.status);
    where.push(`c.status = $${args.length}`);
  } else {
    where.push("c.status <> 'archived'");
  }
  const w = where.join(" AND ");
  const from = "FROM customers c LEFT JOIN business_accounts b ON b.customer_id = c.id";
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n ${from} WHERE ${w}`, args))!.n;
  const items = await query<CustomerRow>(
    `SELECT c.id, c.full_name, c.email, c.phone, c.customer_type, c.status, c.created_at,
            c.user_id IS NOT NULL AS has_account, b.status AS business_status,
            (SELECT count(*)::int FROM addresses a WHERE a.customer_id = c.id) AS address_count
       ${from} WHERE ${w}
      ORDER BY c.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type CustomerDetail = {
  id: string; user_id: string | null; full_name: string; email: string | null; phone: string | null;
  customer_type: "retail" | "business"; status: "active" | "suspended" | "archived"; created_at: Date;
  anonymized_at: Date | null; last_login_at: Date | null; is_staff: boolean;
};

export async function adminGetCustomer(actor: Actor | null, id: string) {
  assertCan(actor, "customers.read");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const customer = await queryOne<CustomerDetail>(
    `SELECT c.id, c.user_id, c.full_name, c.email, c.phone, c.customer_type, c.status, c.created_at, c.anonymized_at,
            u.last_login_at,
            EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = c.user_id AND r.role = ANY($2::app_role[])) AS is_staff
       FROM customers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [id, STAFF_ROLES],
  );
  if (!customer) return null;
  const addresses = await query<{ id: string; label: string; recipient: string; phone: string; city: string; district: string | null; line1: string; is_default: boolean }>(
    "SELECT id, label, recipient, phone, city, district, line1, is_default FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at",
    [id],
  );
  const notes = await query<{ id: number; body: string; created_at: Date; author: string | null }>(
    `SELECT n.id, n.body, n.created_at, p.full_name AS author FROM customer_notes n
       LEFT JOIN profiles p ON p.user_id = n.author_id WHERE n.customer_id = $1 ORDER BY n.created_at DESC`,
    [id],
  );
  return { customer, addresses, notes };
}

const phone = z.string().trim().regex(/^\+?[0-9 ]{8,20}$/, "Numéro de téléphone invalide");

export const customerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom requis").max(120),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(200).optional().or(z.literal("")).transform((v) => v || null),
  phone,
  customerType: z.enum(["retail", "business"]),
});

/** Ajout manuel d'un client sans compte en ligne (ex. client au comptoir). */
export async function createCustomer(actor: Actor | null, input: z.input<typeof customerSchema>) {
  assertCan(actor, "customers.manage");
  const d = customerSchema.parse(input);
  return tx(async (db) => {
    const row = await queryOne<{ id: string }>(
      "INSERT INTO customers (full_name, email, phone, customer_type) VALUES ($1,$2,$3,$4) RETURNING id",
      [d.fullName, d.email, d.phone, d.customerType], db,
    );
    await audit(actor, "customer.create", "customer", row!.id, { after: d }, db);
    return row!.id;
  });
}

/**
 * Modifie les coordonnées. Le passage en « professionnel » ne donne PAS accès
 * aux tarifs de gros : seul un compte professionnel approuvé y donne droit.
 */
export async function updateCustomer(actor: Actor | null, id: string, input: z.input<typeof customerSchema>) {
  assertCan(actor, "customers.manage");
  const d = customerSchema.parse(input);
  try {
    await tx(async (db) => {
      const before = await queryOne<{ user_id: string | null; anonymized_at: Date | null }>(
        "SELECT user_id, anonymized_at, full_name, email, phone, customer_type FROM customers WHERE id = $1 FOR UPDATE", [id], db,
      );
      if (!before) throw new UserError("Client introuvable.");
      if (before.anonymized_at) throw new UserError("Ce client a été anonymisé : sa fiche n'est plus modifiable.");
      await db.query("UPDATE customers SET full_name=$2, email=$3, phone=$4, customer_type=$5 WHERE id=$1",
        [id, d.fullName, d.email, d.phone, d.customerType]);
      if (before.user_id) {
        await db.query("UPDATE profiles SET full_name = $2, phone = $3 WHERE user_id = $1", [before.user_id, d.fullName, d.phone]);
        // L'e-mail de connexion reste celui du compte (non modifié ici).
      }
      await audit(actor, "customer.update", "customer", id, { before, after: d }, db);
    });
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Adresse e-mail déjà utilisée.");
    throw err;
  }
}

export async function addCustomerNote(actor: Actor | null, customerId: string, body: string) {
  assertCan(actor, "customers.manage");
  const text = body.trim();
  if (text.length < 2 || text.length > 5000) throw new UserError("Note vide ou trop longue.", { body: "Entre 2 et 5000 caractères" });
  const c = await queryOne("SELECT 1 FROM customers WHERE id = $1", [customerId]);
  if (!c) throw new UserError("Client introuvable.");
  await query("INSERT INTO customer_notes (customer_id, author_id, body) VALUES ($1, $2, $3)", [customerId, actor.id, text]);
  await audit(actor, "customer.note_add", "customer", customerId);
}

/** Active, suspend ou archive un client (et son compte de connexion). */
export async function setCustomerStatus(actor: Actor | null, id: string, status: "active" | "suspended" | "archived") {
  assertCan(actor, "customers.manage");
  if (!["active", "suspended", "archived"].includes(status)) throw new UserError("Statut invalide.");
  await tx(async (db) => {
    const c = await queryOne<{ status: string; user_id: string | null; anonymized_at: Date | null }>(
      "SELECT status, user_id, anonymized_at FROM customers WHERE id = $1 FOR UPDATE", [id], db,
    );
    if (!c) throw new UserError("Client introuvable.");
    if (c.anonymized_at) throw new UserError("Ce client a été anonymisé.");
    if (c.user_id === actor.id) throw new UserError("Vous ne pouvez pas modifier le statut de votre propre compte.");
    if (c.user_id) {
      const staff = await queryOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = ANY($2::app_role[])", [c.user_id, STAFF_ROLES], db);
      if (staff) throw new UserError("Ce client est aussi membre du personnel : gérez son compte dans « Utilisateurs et rôles ».");
      await db.query("UPDATE users SET status = $2 WHERE id = $1", [c.user_id, status]);
      if (status !== "active") await deleteUserSessions(c.user_id, db);
    }
    await db.query("UPDATE customers SET status = $2 WHERE id = $1", [id, status]);
    const action = { active: "customer.activate", suspended: "customer.suspend", archived: "customer.archive" }[status];
    await audit(actor, action, "customer", id, { before: { status: c.status }, after: { status } }, db);
  });
}

/**
 * Historique transactionnel qui interdit la suppression définitive
 * (commandes et factures référencent aussi le client avec ON DELETE RESTRICT).
 */
async function historyBlockers(customerId: string, db: Parameters<typeof queryOne>[2]) {
  const row = await queryOne<{ business: boolean; prices: number; orders: number; invoices: number }>(
    `SELECT EXISTS (SELECT 1 FROM business_accounts WHERE customer_id = $1 AND status IN ('approved', 'suspended')) AS business,
            (SELECT count(*)::int FROM customer_prices WHERE customer_id = $1) AS prices,
            (SELECT count(*)::int FROM orders WHERE customer_id = $1) AS orders,
            (SELECT count(*)::int FROM invoices WHERE customer_id = $1) AS invoices`,
    [customerId], db,
  );
  const reasons: string[] = [];
  if (row!.orders > 0) reasons.push(`${row!.orders} commande(s)`);
  if (row!.invoices > 0) reasons.push(`${row!.invoices} facture(s)`);
  if (row!.business) reasons.push("compte professionnel approuvé");
  if (row!.prices > 0) reasons.push(`${row!.prices} prix négocié(s)`);
  return reasons;
}

export async function getDeletionBlockers(actor: Actor | null, customerId: string) {
  assertCan(actor, "customers.read");
  return historyBlockers(customerId, undefined);
}

/** Suppression définitive : uniquement sans historique et pour un client archivé. */
export async function deleteCustomer(actor: Actor | null, id: string) {
  assertCan(actor, "customers.delete");
  await tx(async (db) => {
    const c = await queryOne<{ status: string; user_id: string | null; full_name: string; email: string | null }>(
      "SELECT status, user_id, full_name, email FROM customers WHERE id = $1 FOR UPDATE", [id], db,
    );
    if (!c) throw new UserError("Client introuvable.");
    if (c.status !== "archived") throw new UserError("Archivez d'abord le client avant de le supprimer.");
    const blockers = await historyBlockers(id, db);
    if (blockers.length) {
      throw new UserError(`Suppression impossible (${blockers.join(", ")}). Utilisez l'anonymisation pour effacer les données personnelles tout en conservant l'historique.`);
    }
    if (c.user_id) {
      const staff = await queryOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = ANY($2::app_role[])", [c.user_id, STAFF_ROLES], db);
      if (staff) throw new UserError("Ce client est aussi membre du personnel : retirez d'abord ses rôles.");
    }
    try {
      await db.query("DELETE FROM customers WHERE id = $1", [id]);
      if (c.user_id) await db.query("DELETE FROM users WHERE id = $1", [c.user_id]);
    } catch (err) {
      if (pgCode(err) === "23503") throw new UserError("Ce client est lié à un historique : utilisez l'anonymisation.");
      throw err;
    }
    // Le journal conserve la trace de la suppression, sans les données personnelles.
    await audit(actor, "customer.delete", "customer", id, { before: { status: c.status, had_account: !!c.user_id } }, db);
  });
}

/**
 * Anonymisation : efface les données personnelles d'un client archivé tout en
 * conservant les enregistrements nécessaires à l'historique (commandes, factures).
 * Irréversible.
 */
export async function anonymizeCustomer(actor: Actor | null, id: string) {
  assertCan(actor, "customers.delete");
  await tx(async (db) => {
    const c = await queryOne<{ status: string; user_id: string | null; anonymized_at: Date | null }>(
      "SELECT status, user_id, anonymized_at FROM customers WHERE id = $1 FOR UPDATE", [id], db,
    );
    if (!c) throw new UserError("Client introuvable.");
    if (c.anonymized_at) throw new UserError("Ce client est déjà anonymisé.");
    if (c.status !== "archived") throw new UserError("Archivez d'abord le client avant de l'anonymiser.");
    const label = `Client anonymisé ${id.slice(0, 8)}`;
    await db.query(
      "UPDATE customers SET full_name = $2, email = NULL, phone = NULL, anonymized_at = now() WHERE id = $1",
      [id, label],
    );
    await db.query("DELETE FROM addresses WHERE customer_id = $1", [id]);
    await db.query(
      `UPDATE business_accounts SET contact_name = 'Anonymisé', phone = 'Anonymisé', email = NULL, address_line = 'Anonymisée',
              professional_id = NULL, message = NULL WHERE customer_id = $1`,
      [id],
    );
    if (c.user_id) {
      const staff = await queryOne("SELECT 1 FROM user_roles WHERE user_id = $1 AND role = ANY($2::app_role[])", [c.user_id, STAFF_ROLES], db);
      if (staff) throw new UserError("Ce client est aussi membre du personnel : retirez d'abord ses rôles.");
      await db.query("UPDATE users SET email = $2, password_hash = $3, status = 'archived' WHERE id = $1",
        [c.user_id, `anonyme-${id}@invalid.local`, await hashPassword(randomBytes(32).toString("hex"))]);
      await db.query("UPDATE profiles SET full_name = $2, phone = NULL WHERE user_id = $1", [c.user_id, label]);
      await deleteUserSessions(c.user_id, db);
    }
    await audit(actor, "customer.anonymize", "customer", id, {}, db);
  });
}
