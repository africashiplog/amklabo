import { NextResponse, type NextRequest } from "next/server";

/**
 * Politique de sécurité du contenu avec nonce par requête : seuls les scripts
 * émis par l'application (porteurs du nonce) s'exécutent. Next.js applique
 * automatiquement le nonce à ses propres scripts.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Les attributs style (propriétés logiques RTL, graphiques) nécessitent 'unsafe-inline' pour les styles uniquement.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Pas sur les fichiers statiques ni sur les fichiers binaires servis par l'application.
  matcher: [{ source: "/((?!_next/static|_next/image|brand/|media/|favicon).*)" }],
};
