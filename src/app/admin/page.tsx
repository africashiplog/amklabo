import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDateTime } from "@/lib/format";
import { requireActorPage } from "@/server/current";
import { can } from "@/server/permissions";
import { getDashboardStats, getSalesStats, PERIODS } from "@/server/services/dashboard";
import { formatMRU } from "@/lib/money";
import { ORDER_STATUS } from "@/server/services/orders";
import { getStockAlertCounts } from "@/server/services/stock";

function Stat({ label, value, href, tone = "blue", sub }: { label: string; value: number; href?: string; tone?: "blue" | "green" | "amber"; sub?: string }) {
  const color = { blue: "text-brand-800", green: "text-leaf-700", amber: "text-amber-700" }[tone];
  const body = (
    <Card className="h-full p-5 transition hover:border-brand-200">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const UPCOMING = [
  ["Paiements à vérifier", "Phase 4 — paiements"],
  ["Livraisons en attente / en cours", "Phase 4 — livraisons"],
  ["Rapports détaillés et exports CSV", "Phase 5 — rapports"],
] as const;

function Money({ label, value, sub, href }: { label: string; value: number; sub?: string; href?: string }) {
  const body = (
    <Card className="h-full p-5">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-bold text-brand-800">{formatMRU(value)}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const actor = await requireActorPage("/admin");
  if (!can(actor.roles, "dashboard.view")) redirect("/acces-refuse");
  const sales = await getSalesStats(actor, Number((await searchParams).periode) || 30);
  const [{ counts: c, recentCustomers, recentActivity }, stock] = await Promise.all([getDashboardStats(actor), getStockAlertCounts(actor)]);
  const stockLink = can(actor.roles, "stock.manage");

  return (
    <>
      <PageHeader title="Tableau de bord" description="Indicateurs calculés en temps réel à partir de la base de données." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Période">
        {Object.entries(PERIODS).map(([k, label]) => (
          <Link key={k} href={`/admin?periode=${k}`} className={`rounded-full px-3 py-1.5 font-medium ring-1 ${String(sales.days) === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      <h2 className="mb-3 font-semibold text-slate-900">Ventes — {PERIODS[String(sales.days) as keyof typeof PERIODS].toLowerCase()}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {sales.revenue && <Money label="Chiffre d'affaires facturé" value={sales.revenue.invoiced - sales.revenue.credited} sub={`factures émises ${formatMRU(sales.revenue.invoiced)} − avoirs ${formatMRU(sales.revenue.credited)}`} href="/admin/factures" />}
        {sales.revenue && <Money label="Factures impayées" value={sales.revenue.unpaid_minor} sub={`${sales.revenue.unpaid_count} facture(s) — règlements : Phase 4`} href="/admin/factures?impayees=1" />}
        <Stat label="Commandes" value={sales.orders.total} sub="hors annulées" href="/admin/commandes?statut=all" />
        <Stat label="Commandes à traiter" value={sales.orders.to_process} href="/admin/commandes" tone={sales.orders.to_process ? "amber" : "green"} />
        <Money label="Commandes au détail" value={sales.orders.retail_minor} sub={`${sales.orders.retail} commande(s)`} />
        <Money label="Commandes en gros (pros)" value={sales.orders.business_minor} sub={`${sales.orders.business} commande(s)`} />
        <Stat label="Demandes d'annulation" value={sales.orders.cancel_requests} href="/admin/commandes?statut=all&signal=cancel_request" tone={sales.orders.cancel_requests ? "amber" : "blue"} />
        <Stat label="Retours en cours" value={sales.orders.returns_open} href="/admin/commandes?statut=all&signal=return" tone={sales.orders.returns_open ? "amber" : "blue"} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Le chiffre d&apos;affaires est le montant facturé (TTC si une taxe est configurée), et non un bénéfice.</p>

      <h2 className="mb-3 mt-8 font-semibold text-slate-900">Catalogue et clients</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Produits publiés" value={c.products_published} href="/admin/produits?statut=published" tone="green" sub={`${c.products_total} au total`} />
        <Stat label="Brouillons" value={c.products_draft} href="/admin/produits?statut=draft" />
        <Stat label="Indisponibles" value={c.products_unavailable} href="/admin/produits?statut=unavailable" tone="amber" />
        <Stat label="Publiés sans image" value={c.products_without_image} tone="amber" />
        <Stat label="Catégories actives" value={c.categories_active} href="/admin/categories" sub={`${c.categories_total} au total`} />
        <Stat label="Clients" value={c.customers_total} href="/admin/clients" sub={`${c.customers_30d} sur 30 jours`} tone="green" />
        <Stat label="Messages à traiter" value={c.messages_open} href="/admin/messages" tone={c.messages_open ? "amber" : "blue"} />
        <Stat label="Zones de livraison actives" value={c.zones_active} href="/admin/livraison" />
      </div>

      <h2 className="mb-3 mt-8 font-semibold text-slate-900">Stock et approvisionnement</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Produits en rupture" value={stock.out_of_stock} href={stockLink ? "/admin/stock?filtre=out" : undefined} tone={stock.out_of_stock ? "amber" : "green"} sub="produits publiés" />
        <Stat label="Stock bas" value={stock.low_stock} href={stockLink ? "/admin/stock?filtre=low" : undefined} tone={stock.low_stock ? "amber" : "green"} sub="sous le seuil d'alerte" />
        <Stat label="Lots proches de la péremption" value={stock.expiring_lots} href={stockLink ? "/admin/stock/peremptions" : undefined} tone={stock.expiring_lots ? "amber" : "green"} />
        <Stat label="Lots périmés en stock" value={stock.expired_lots} href={stockLink ? "/admin/stock/peremptions" : undefined} tone={stock.expired_lots ? "amber" : "green"} />
        <Stat label="Bons d'achat en attente" value={c.purchases_open} href={can(actor.roles, "suppliers.manage") ? "/admin/achats?statut=ordered" : undefined} />
        <Stat label="Demandes pro à examiner" value={c.business_pending} href="/admin/professionnels" tone={c.business_pending ? "amber" : "blue"} />
        <Stat label="Comptes pro approuvés" value={c.business_approved} href="/admin/professionnels?statut=approved" tone="green" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="font-semibold">Dernières commandes</h2>
          {sales.latest.length === 0 ? <p className="mt-3 text-sm text-slate-500">Aucune commande pour le moment.</p> : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {sales.latest.map((o) => (
                <li key={o.id} className="flex justify-between gap-2 py-2">
                  <span><Link href={`/admin/commandes/${o.id}`} className="font-mono text-brand-800 hover:underline">{o.number}</Link> <span className="text-slate-500">· {o.business_name ?? o.customer_name} · {ORDER_STATUS[o.status as "new"]}</span></span>
                  <span className="shrink-0 font-medium">{formatMRU(o.total_minor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Derniers clients inscrits</h2>
          {recentCustomers.length === 0 ? <p className="mt-3 text-sm text-slate-500">Aucun client pour le moment.</p> : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {recentCustomers.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 py-2">
                  <span>{r.full_name} <span className="text-slate-400">· {t.customerType[r.customer_type as "retail"]}</span></span>
                  <span className="text-slate-500">{formatDateTime(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Activité récente</h2>
          {recentActivity.length === 0 ? <p className="mt-3 text-sm text-slate-500">Aucune activité.</p> : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-2">
                  <span><code className="text-xs text-brand-800">{a.action}</code> <span className="text-slate-500">{a.actor_email ?? "système"}</span></span>
                  <span className="shrink-0 text-slate-500">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-8 p-5">
        <h2 className="font-semibold">Indicateurs des prochaines phases</h2>
        <p className="mt-1 text-sm text-slate-600">Ces indicateurs apparaîtront lorsque les modules correspondants seront en service. Aucun chiffre fictif n&apos;est affiché.</p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {UPCOMING.map(([label, phase]) => (
            <li key={label} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-medium">{label}</span> <span className="text-slate-500">— {phase}</span></li>
          ))}
        </ul>
      </Card>
    </>
  );
}
