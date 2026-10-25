import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx } from "../db";
import { UnauthenticatedError, UserError } from "../errors";
import { z } from "../validation";

export const ACTIVITIES = {
  laboratory: "Laboratoire d'analyses",
  clinic: "Clinique",
  hospital: "Hôpital",
  pharmacy: "Pharmacie",
  medical_office: "Cabinet médical",
  distributor: "Distributeur",
  company: "Entreprise / organisme",
  other: "Autre",
} as const;

export const BUSINESS_STATUS = {
  pending: "En attente d'examen",
  approved: "Approuvé",
  rejected: "Refusé",
  suspended: "Suspendu",
} as const;

export type BusinessAccount = {
  id: string; customer_id: string; establishment_name: string; activity: keyof typeof ACTIVITIES; contact_name: string;
  phone: string; email: string | null; address_line: string; city: string; professional_id: string | null;
  message: string | null; status: keyof typeof BUSINESS_STATUS; submitted_at: Date; reviewed_at: Date | null;
  reviewer_name: string | null; decision_reason: string | null;
};

const SELECT = `SELECT b.*, p.full_name AS reviewer_name FROM business_accounts b LEFT JOIN profiles p ON p.user_id = b.reviewed_by`;

export const businessRequestSchema = z.object({
  establishmentName: z.string().trim().min(2, "Nom de l'établissement requis").max(200),
  activity: z.enum(Object.keys(ACTIVITIES) as [keyof typeof ACTIVITIES]),
  contactName: z.string().trim().min(2, "Nom du contact requis").max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,20}$/, "Numéro de téléphone invalide"),
  email: z.string().trim().email("Adresse e-mail invalide").max(200).optional().or(z.literal("")).transform((v) => v || null),
  addressLine: z.string().trim().min(3, "Adresse requise").max(300),
  city: z.string().trim().min(2).max(80),
  professionalId: z.string().trim().max(80).optional().transform((v) => v || null),
  message: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function getMyBusinessAccount(actor: Actor | null) {
  if (!actor) throw new UnauthenticatedError();
  return queryOne<BusinessAccount>(`${SELECT} JOIN customers c ON c.id = b.customer_id WHERE c.user_id = $1`, [actor.id]);
}

/** Dépose (ou redépose après refus) une demande de compte professionnel. */
export async function submitBusinessRequest(actor: Actor | null, input: z.input<typeof businessRequestSchema>) {
  if (!actor) throw new UnauthenticatedError();
  const d = businessRequestSchema.parse(input);
  await tx(async (db) => {
    const customer = await queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM customers WHERE user_id = $1 FOR UPDATE", [actor.id], db,
    );
    if (!customer) throw new UserError("Seuls les comptes clients peuvent demander un compte professionnel.");
    if (customer.status !== "active") throw new UserError("Votre compte n'est pas actif.");
    const existing = await queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM business_accounts WHERE customer_id = $1", [customer.id], db,
    );
    const values = [d.establishmentName, d.activity, d.contactName, d.phone, d.email, d.addressLine, d.city, d.professionalId, d.message];
    if (existing) {
      if (existing.status !== "rejected") {
        throw new UserError(existing.status === "pending" ? "Votre demande est déjà en cours d'examen." : "Votre compte professionnel existe déjà.");
      }
      await db.query(
        `UPDATE business_accounts SET establishment_name=$1, activity=$2, contact_name=$3, phone=$4, email=$5, address_line=$6,
                city=$7, professional_id=$8, message=$9, status='pending', submitted_at=now(), reviewed_at=NULL, reviewed_by=NULL,
                decision_reason=NULL
          WHERE id = $10`,
        [...values, existing.id],
      );
      await audit(actor, "business.resubmit", "business_account", existing.id, { after: d }, db);
    } else {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO business_accounts (establishment_name, activity, contact_name, phone, email, address_line, city,
                                        professional_id, message, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [...values, customer.id], db,
      );
      await audit(actor, "business.request", "business_account", row!.id, { after: d }, db);
    }
  });
}

export async function adminListBusinessAccounts(actor: Actor | null, status?: string) {
  assertCan(actor, "customers.read");
  const valid = status && status in BUSINESS_STATUS ? status : null;
  return query<BusinessAccount & { customer_name: string; customer_email: string | null }>(
    `SELECT b.*, p.full_name AS reviewer_name, c.full_name AS customer_name, c.email AS customer_email
       FROM business_accounts b JOIN customers c ON c.id = b.customer_id LEFT JOIN profiles p ON p.user_id = b.reviewed_by
      WHERE ($1::business_status IS NULL OR b.status = $1::business_status)
      ORDER BY (b.status = 'pending') DESC, b.submitted_at DESC LIMIT 200`,
    [valid],
  );
}

export async function adminGetBusinessAccountForCustomer(actor: Actor | null, customerId: string) {
  assertCan(actor, "customers.read");
  return queryOne<BusinessAccount>(`${SELECT} WHERE b.customer_id = $1`, [customerId]);
}

type Decision = "approve" | "reject" | "suspend" | "reinstate";

const TRANSITIONS: Record<Decision, { from: string[]; to: string; action: string }> = {
  approve: { from: ["pending"], to: "approved", action: "business.approve" },
  reject: { from: ["pending"], to: "rejected", action: "business.reject" },
  suspend: { from: ["approved"], to: "suspended", action: "business.suspend" },
  reinstate: { from: ["suspended"], to: "approved", action: "business.reinstate" },
};

/**
 * Décision sur un compte professionnel. Le droit aux tarifs de gros dépend
 * uniquement du statut « approuvé » ; le rôle customer_business est tenu à jour
 * pour l'affichage et les futures permissions.
 */
export async function reviewBusinessAccount(actor: Actor | null, id: string, decision: Decision, reason: string | null) {
  assertCan(actor, "business.approve");
  const t = TRANSITIONS[decision];
  if (!t) throw new UserError("Décision invalide.");
  const why = reason?.trim() || null;
  if ((decision === "reject" || decision === "suspend") && !why) {
    throw new UserError("Indiquez le motif de la décision.", { reason: "Motif requis" });
  }
  await tx(async (db) => {
    const before = await queryOne<{ status: string; customer_id: string; user_id: string | null }>(
      `SELECT b.status, b.customer_id, c.user_id FROM business_accounts b JOIN customers c ON c.id = b.customer_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [id], db,
    );
    if (!before) throw new UserError("Demande introuvable.");
    if (!t.from.includes(before.status)) throw new UserError("Cette décision n'est pas possible dans l'état actuel de la demande.");
    await db.query(
      "UPDATE business_accounts SET status = $2, reviewed_at = now(), reviewed_by = $3, decision_reason = $4 WHERE id = $1",
      [id, t.to, actor.id, why],
    );
    if (t.to === "approved") {
      await db.query("UPDATE customers SET customer_type = 'business' WHERE id = $1", [before.customer_id]);
      if (before.user_id) {
        await db.query(
          "INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'customer_business', $2) ON CONFLICT DO NOTHING",
          [before.user_id, actor.id],
        );
      }
    } else if (before.user_id) {
      await db.query("DELETE FROM user_roles WHERE user_id = $1 AND role = 'customer_business'", [before.user_id]);
    }
    await audit(actor, t.action, "business_account", id,
      { before: { status: before.status }, after: { status: t.to, reason: why } }, db);
  });
}
