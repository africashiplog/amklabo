import { getActor } from "@/server/current";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { getInvoiceForViewer, type SellerSnapshot } from "@/server/services/invoices";
import { getStoreSettings } from "@/server/services/settings";

/**
 * PDF d'une facture ou d'un avoir. Le personnel autorisé voit tous les
 * documents ; un client uniquement ses propres documents émis.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Veuillez vous connecter.", { status: 401 });
  const data = await getInvoiceForViewer(actor, (await params).id).catch(() => null);
  if (!data) return new Response("Document introuvable.", { status: 404 });
  const s = await getStoreSettings();
  const fallback: SellerSnapshot = { ...s, tax_label: (s as { tax_label?: string }).tax_label ?? "TVA" };
  const pdf = await renderInvoicePdf(data.invoice, data.items, fallback);
  const name = `${data.invoice.kind === "credit_note" ? "avoir" : "facture"}-${data.invoice.number ?? "brouillon"}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
