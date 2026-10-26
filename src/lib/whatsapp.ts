/**
 * Liens WhatsApp « cliquer pour discuter » (wa.me) avec un message prérempli.
 * Aucun envoi automatique : un membre de l'équipe ouvre WhatsApp et envoie
 * lui-même le message depuis le téléphone de la boutique.
 */
import { formatMRU } from "./money";

/** Numéro au format international sans « + » (indicatif 222 ajouté aux numéros mauritaniens à 8 chiffres). */
export function normalizeWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");
  if (/^[234]\d{7}$/.test(digits)) digits = `222${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsAppLink(phone: string | null | undefined, message: string): string | null {
  const n = normalizeWhatsAppNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}

/** Adresse publique de la boutique (APP_URL), pour inclure un lien dans le message. */
export function publicUrl(path: string): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return base && /^https?:\/\//.test(base) ? `${base}${path}` : null;
}

/** Message de suivi de commande, rédigé à partir des données réelles de la commande. */
export function orderMessage(o: {
  storeName: string; customerName: string; number: string; statusLabel: string; totalMinor: number; dueMinor: number;
  shippingPending: boolean; shippingMinor: number;
}) {
  const lines = [
    `Bonjour ${o.customerName},`,
    `${o.storeName} — votre commande ${o.number} : ${o.statusLabel.toLowerCase()}.`,
  ];
  if (o.shippingPending) lines.push("Nous calculons les frais de livraison et revenons vers vous avec le total à payer.");
  else {
    lines.push(`Frais de livraison : ${formatMRU(o.shippingMinor)}. Total : ${formatMRU(o.totalMinor)}.`);
    if (o.dueMinor > 0) lines.push(`Reste à payer : ${formatMRU(o.dueMinor)}.`);
  }
  const url = publicUrl(`/compte/commandes/${o.number}`);
  if (url) lines.push(`Suivi : ${url}`);
  lines.push("Nous ne vous demanderons jamais votre code PIN ni votre mot de passe.");
  return lines.join("\n");
}
