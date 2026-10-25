import fs from "node:fs/promises";
import { MIME, resolveStoragePath } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const abs = resolveStoragePath(rel);
  if (!abs) return new Response("Introuvable", { status: 404 });
  try {
    const data = await fs.readFile(abs);
    const ext = rel.split(".").pop()!;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        // Noms de fichiers aléatoires et immuables : mise en cache longue.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
