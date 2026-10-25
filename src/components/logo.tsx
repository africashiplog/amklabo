import { mediaUrl } from "@/server/storage";
import { DEFAULT_LOGO } from "@/server/services/settings";

/**
 * Logo officiel AMKLABO (ou logo de remplacement défini dans les paramètres).
 * Hauteur fixe, largeur automatique : les proportions ne sont jamais modifiées.
 */
export function Logo({ logoPath, name, className = "h-12" }: { logoPath: string | null; name: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logoPath ? mediaUrl(logoPath) : DEFAULT_LOGO} alt={name} className={`${className} w-auto object-contain`} />;
}
