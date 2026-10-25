import fs from "node:fs/promises";
import { getActor } from "@/server/current";
import { getProofPath } from "@/server/services/payments";
import { MIME, resolveStoragePath } from "@/server/storage";

/** Justificatif de paiement : personnel autorisé ou client qui l'a transmis. Jamais public. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Veuillez vous connecter.", { status: 401 });
  const rel = await getProofPath(actor, (await params).id).catch((err: unknown) => {
    console.error("[justificatif]", err instanceof Error ? err.message : err);
    return null;
  });
  const abs = rel ? resolveStoragePath(rel, true) : null;
  if (!abs) return new Response("Introuvable.", { status: 404 });
  try {
    const data = await fs.readFile(abs);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": MIME[rel!.split(".").pop()!], "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'" },
    });
  } catch {
    return new Response("Introuvable.", { status: 404 });
  }
}
