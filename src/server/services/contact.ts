import { z } from "../validation";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne } from "../db";
import { UserError } from "../errors";

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Nom requis").max(120),
    email: z.string().trim().email("Adresse e-mail invalide").max(200).optional().or(z.literal("")).transform((v) => v || null),
    phone: z.string().trim().max(30).optional().transform((v) => v || null),
    subject: z.string().trim().min(2, "Objet requis").max(150),
    message: z.string().trim().min(10, "Message trop court").max(5000),
  })
  .refine((d) => d.email || d.phone, { message: "Indiquez un e-mail ou un téléphone", path: ["email"] });

export async function submitContactMessage(input: z.input<typeof contactSchema>, userId: string | null, ip: string | null) {
  const d = contactSchema.parse(input);
  // Limitation simple : 5 messages par heure et par adresse IP.
  if (ip) {
    const recent = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'contact.submit' AND ip = $1 AND created_at > now() - interval '1 hour'`,
      [ip],
    );
    if ((recent?.n ?? 0) >= 5) throw new UserError("Trop de messages envoyés. Réessayez plus tard.");
  }
  const row = await queryOne<{ id: string }>(
    "INSERT INTO contact_messages (name, email, phone, subject, message, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [d.name, d.email, d.phone, d.subject, d.message, userId],
  );
  await query(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, ip) VALUES ($1, 'contact.submit', 'contact_message', $2, $3)",
    [userId, row!.id, ip],
  );
}

export type ContactMessage = {
  id: string; name: string; email: string | null; phone: string | null; subject: string; message: string;
  created_at: Date; handled_at: Date | null; handled_by_name: string | null;
};

export async function listContactMessages(actor: Actor | null, onlyOpen: boolean) {
  assertCan(actor, "messages.manage");
  return query<ContactMessage>(
    `SELECT m.*, p.full_name AS handled_by_name FROM contact_messages m
       LEFT JOIN profiles p ON p.user_id = m.handled_by
      WHERE ($1::boolean IS FALSE OR m.handled_at IS NULL)
      ORDER BY m.created_at DESC LIMIT 200`,
    [onlyOpen],
  );
}

export async function markMessageHandled(actor: Actor | null, id: string) {
  assertCan(actor, "messages.manage");
  const row = await queryOne(
    "UPDATE contact_messages SET handled_at = now(), handled_by = $2 WHERE id = $1 AND handled_at IS NULL RETURNING id",
    [id, actor.id],
  );
  if (!row) throw new UserError("Message introuvable ou déjà traité.");
  await audit(actor, "contact.handled", "contact_message", id);
}
