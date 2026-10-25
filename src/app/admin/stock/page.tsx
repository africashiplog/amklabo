import Link from "next/link";
import { Badge, EmptyState, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { requirePermissionPage } from "@/server/current";
import { getStockOverview } from "@/server/services/stock";

const FILTERS = [["all", "Tous"], ["out", "Ruptures"], ["low", "Stock bas"], ["expiring", "Péremption proche / périmés"]] as const;

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("stock.manage");
  const sp = await searchParams;
  const filter = sp.filtre ?? "all";
  const r = await getStockOverview(actor, { q: sp.q, filter, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Stock" description={`Disponible = stock physique non périmé moins les quantités réservées par les commandes en cours. Unités de vente. Alerte de péremption : ${r.alertDays} jours (modifiable dans les paramètres).`} />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Filtres">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/admin/stock?filtre=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${filter === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      <form className="mb-4 flex gap-2">
        <input type="hidden" name="filtre" value={filter} />
        <input name="q" defaultValue={sp.q} placeholder="Nom ou SKU" aria-label="Recherche" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Rechercher</button>
      </form>
      {r.items.length === 0 ? <EmptyState title="Aucun produit" /> : (
        <Table>
          <thead><tr><th className={th}>Produit</th><th className={th}>Disponible</th><th className={th}>Réservé</th><th className={th}>Seuil</th><th className={th}>Prochaine péremption</th><th className={th}>État</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className={td}>
                  <Link href={`/admin/stock/${p.id}`} className="font-medium text-brand-800 hover:underline">{p.name}</Link>
                  <div className="font-mono text-xs text-slate-400">{p.sku}</div>
                </td>
                <td className={`${td} font-semibold`}>{p.on_hand} <span className="text-xs font-normal text-slate-500">{t.saleUnit[p.sale_unit as "box"].toLowerCase()}(s)</span></td>
                <td className={td}>{p.reserved}</td>
                <td className={td}>{p.stock_alert_threshold}</td>
                <td className={td}>{p.next_expiry ?? (p.track_lots ? "—" : "non suivi")}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {p.on_hand === 0 ? <Badge tone="red">Rupture</Badge> : p.on_hand <= p.stock_alert_threshold ? <Badge tone="amber">Stock bas</Badge> : <Badge tone="green">OK</Badge>}
                    {p.expired_qty > 0 && <Badge tone="red">{p.expired_qty} périmé(s)</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/stock" params={{ q: sp.q, filtre: sp.filtre }} />
    </>
  );
}
