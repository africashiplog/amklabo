import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "./actor";
import { can, type Permission } from "./permissions";
import { getSessionActor, SESSION_COOKIE } from "./session";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  // N'accepte qu'une adresse IPv4/IPv6 plausible (stockée dans une colonne inet).
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** Utilisateur courant (mis en cache pour la durée de la requête). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await getSessionActor(token);
  if (!actor) return null;
  return { ...actor, ip: await clientIp() };
});

/** Pour les pages : redirige vers la connexion si nécessaire. */
export async function requireActorPage(next: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/connexion?next=${encodeURIComponent(next)}`);
  return actor;
}

/** Pour les pages d'administration : vérifie la permission côté serveur. */
export async function requirePermissionPage(permission: Permission, next = "/admin"): Promise<Actor> {
  const actor = await requireActorPage(next);
  if (!can(actor.roles, permission)) redirect("/acces-refuse");
  return actor;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
