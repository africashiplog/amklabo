import { getActor } from "@/server/current";
import { audit } from "@/server/audit";
import { ForbiddenError, UnauthenticatedError, UserError } from "@/server/errors";
import {
  cancellationsReport, csvMoney, expiringLotsReport, parseRange, paymentsReport, salesByCategory, salesByPeriod, salesByProduct,
  stockReport, toCsv, unpaidInvoicesReport, type Grain,
} from "@/server/services/reports";

const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "");

/** Export CSV d'un rapport. Chaque service vérifie les droits ; chaque export est journalisé. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  try {
    const actor = await getActor();
    const r = parseRange(url.searchParams.get("du") ?? undefined, url.searchParams.get("au") ?? undefined);
    let header: string[] = [];
    let rows: (string | number | null)[][] = [];
    switch (type) {
      case "ventes": {
        const data = await salesByPeriod(actor, r, (url.searchParams.get("grain") ?? "day") as Grain);
        header = ["Période", "Commandes", "Ventes (MRU)", "Commandes détail", "Ventes détail (MRU)", "Commandes pros", "Ventes pros (MRU)", "Facturé (MRU)", "Avoirs (MRU)", "CA facturé net (MRU)"];
        rows = data.map((d) => [d.period, d.orders, csvMoney(d.total_minor), d.retail_orders, csvMoney(d.retail_minor), d.business_orders,
          csvMoney(d.business_minor), csvMoney(d.invoiced_minor), csvMoney(d.credited_minor), csvMoney(d.invoiced_minor - d.credited_minor)]);
        break;
      }
      case "produits": {
        const data = await salesByProduct(actor, r, url.searchParams.get("tri") === "quantite" ? "quantity" : "revenue", 1000);
        header = ["Référence", "Produit", "Catégorie", "Quantité", "Commandes", "Ventes (MRU)", "dont détail (MRU)", "dont pros (MRU)"];
        rows = data.map((d) => [d.sku, d.name, d.category_name, d.quantity, d.orders, csvMoney(d.revenue_minor), csvMoney(d.retail_revenue_minor), csvMoney(d.business_revenue_minor)]);
        break;
      }
      case "categories": {
        const data = await salesByCategory(actor, r);
        header = ["Catégorie", "Quantité", "Commandes", "Ventes (MRU)"];
        rows = data.map((d) => [d.category_name, d.quantity, d.orders, csvMoney(d.revenue_minor)]);
        break;
      }
      case "stock": {
        const data = await stockReport(actor);
        header = ["Référence", "Produit", "Statut", "Physique", "Réservé", "Disponible", "Seuil", "Périmé", "Prochaine péremption", "État"];
        rows = data.map((d) => [d.sku, d.name, d.status, d.physical, d.reserved, d.available, d.threshold, d.expired, d.next_expiry, d.state]);
        break;
      }
      case "peremptions": {
        const data = await expiringLotsReport(actor, Number(url.searchParams.get("jours")) || 90);
        header = ["Référence", "Produit", "Lot", "Péremption", "Quantité", "Réservé", "Jours restants"];
        rows = data.map((d) => [d.sku, d.name, d.lot_number, d.expiry_date, d.qty_on_hand, d.qty_reserved, d.days_left]);
        break;
      }
      case "annulations": {
        const { cancelled } = await cancellationsReport(actor, r);
        header = ["Commande", "Passée le", "Annulée le", "Client", "Montant (MRU)", "Motif"];
        rows = cancelled.map((d) => [d.number, iso(d.placed_at), iso(d.cancelled_at), d.customer, csvMoney(d.total_minor), d.reason]);
        break;
      }
      case "retours": {
        const { returns } = await cancellationsReport(actor, r);
        header = ["Commande", "Demandé le", "Statut", "Client", "Montant commande (MRU)", "Motif", "Remis en stock"];
        rows = returns.map((d) => [d.number, iso(d.requested_at), d.status, d.customer, csvMoney(d.total_minor), d.reason, d.restocked === null ? "" : d.restocked ? "oui" : "non"]);
        break;
      }
      case "paiements": {
        const { byMethod } = await paymentsReport(actor, r);
        header = ["Moyen", "Confirmés", "Montant confirmé (MRU)", "Remboursé (MRU)", "En attente", "Montant en attente (MRU)", "Refusés"];
        rows = byMethod.map((d) => [d.method, d.confirmed_count, csvMoney(d.confirmed_minor), csvMoney(d.refunded_minor), d.pending_count, csvMoney(d.pending_minor), d.refused_count]);
        break;
      }
      case "impayes": {
        const { invoices } = await unpaidInvoicesReport(actor);
        header = ["Facture", "Émise le", "Échéance", "Client", "Total (MRU)", "Avoirs (MRU)", "Réglé (MRU)", "Reste dû (MRU)", "Jours de retard"];
        rows = invoices.map((d) => [d.number, d.issue_date, d.due_date, d.customer, csvMoney(d.total_minor), csvMoney(d.credited_minor), csvMoney(d.paid_minor), csvMoney(d.balance_minor), d.days_overdue]);
        break;
      }
      case "soldes": {
        const { balances } = await unpaidInvoicesReport(actor);
        header = ["Client", "Factures non soldées", "Solde dû (MRU)"];
        rows = balances.map((d) => [d.customer, d.count, csvMoney(d.balance_minor)]);
        break;
      }
      default:
        return new Response("Rapport inconnu.", { status: 400 });
    }
    await audit(actor, "report.export", "report", type, { after: { ...r, rows: rows.length } });
    return new Response(toCsv(header, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="amklabo-${type}-${r.from}_${r.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return new Response("Veuillez vous connecter.", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Accès refusé.", { status: 403 });
    if (err instanceof UserError) return new Response(err.message, { status: 400 });
    console.error("[export]", err instanceof Error ? err.message : err);
    return new Response("Erreur lors de l'export.", { status: 500 });
  }
}
