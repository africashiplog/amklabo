import { buttonClass } from "@/components/ui";
import { whatsAppLink } from "@/lib/whatsapp";

/** Ouvre WhatsApp avec un message prérempli ; l'envoi reste fait par la personne. */
export function WhatsAppButton({ phone, message, label = "Prévenir sur WhatsApp" }: { phone: string | null | undefined; message: string; label?: string }) {
  const href = whatsAppLink(phone, message);
  if (!href) return <p className="text-xs text-slate-500">WhatsApp : numéro du client absent ou invalide.</p>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass("success", "sm")}>
      {label}
    </a>
  );
}
