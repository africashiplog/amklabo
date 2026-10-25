import Link from "next/link";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-badges";
import { Badge, EmptyState, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { adminListOrders, ORDER_STATUS } from "@/server/services/orders";

export default async function AdminOrders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("orders.read");
  const sp = await searchParams;
  const status = sp.statut ?? "open";
  const r = await adminListOrders(actor, { q: sp.q, status, flag: sp.signal, page: Number(sp.page) || 1 });
  const tabs: [string, string][] = [["open", "À traiter"], ...Object.entries(ORDER_STATUS) as [string, string][], ["all", "Toutes"]];
  return (
    <>
      <PageHeader title="Commandes" description={`${r.total} commande(s)`} />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Statut">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/admin/commandes?statut=${k}`}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${status === k && !sp.signal ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
        <Link href="/admin/commandes?statut=all&signal=cancel_request" className={`rounded-full px-3 py-1.5 font-medium ring-1 ${sp.signal === "cancel_request" ? "bg-amber-600 text-white ring-amber-600" : "bg-white text-amber-800 ring-amber-300"}`}>Demandes d&apos;annulation</Link>
        <Link href="/admin/commandes?statut=all&signal=return" className={`rounded-full px-3 py-1.5 font-medium ring-1 ${sp.signal === "return" ? "bg-amber-600 text-white ring-amber-600" : "bg-white text-amber-800 ring-amber-300"}`}>Retours en cours</Link>
      </nav>
      <form className="mb-4 flex gap-2">
        <input type="hidden" name="statut" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Numéro, client, établissement, téléphone" aria-label="Recherche" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Rechercher</button>
      </form>
      {r.items.length === 0 ? <EmptyState title="Aucune commande" /> : (
        <Table>
          <thead><tr><th className={th}>Numéro</th><th className={th}>Client</th><th className={th}>Total</th><th className={th}>Commande</th><th className={th}>Paiement</th><th className={th}>Date</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.items.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className={td}><Link href={`/admin/commandes/${o.id}`} className="font-mono font-semibold text-brand-800 hover:underline">{o.number}</Link></td>
                <td className={td}>{o.business_name ?? o.customer_name}<div className="text-xs text-slate-500">{o.customer_type === "business" ? "Professionnel" : "Particulier"} · {o.item_count} article(s)</div></td>
                <td className={`${td} whitespace-nowrap`}>{formatMRU(o.total_minor)}</td>
                <td className={td}>
                  <OrderStatusBadge status={o.status} />
                  {o.cancel_requested_at && <div className="mt-1"><Badge tone="amber">Annulation demandée</Badge></div>}
                  {o.open_return && <div className="mt-1"><Badge tone="amber">Retour</Badge></div>}
                </td>
                <td className={td}><PaymentStatusBadge status={o.payment_status} /></td>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(o.placed_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/commandes" params={{ q: sp.q, statut: sp.statut, signal: sp.signal }} />
    </>
  );
}
