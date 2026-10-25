import { queryOne } from "@/server/db";

export const dynamic = "force-dynamic";

/** Contrôle de santé pour l'hébergeur / la supervision : application + base de données. */
export async function GET() {
  try {
    await queryOne("SELECT 1");
    return Response.json({ statut: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ statut: "base de données indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
