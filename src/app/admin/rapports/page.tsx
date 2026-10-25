import Link from "next/link";
import { PeriodChart } from "@/components/period-chart";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import {
  cancellationsReport, expiringLotsReport, parseRange, paymentsReport, salesByCategory, salesByPeriod, salesByProduct,
  stockReport, unpaidInvoicesReport, type Grain,
} from "@/server/services/reports";

const VIEWS = [
  ["ventes", "Ventes", "reports.view"], ["produits", "Produits", "reports.view"], ["categories", "Catégories", "reports.view"],
  ["stock", "Stock", "stock"], ["annulations", "Annulations et retours", "reports.view"], ["paiements", "Paiements", "reports.view"],
  ["impayes", "Impayés et soldes", "unpaid"],
] as const;

type SP = { vue?: string; du?: string; au?: string; grain?: string; tri?: string };

function Export({ type, sp, extra = "" }: { type: string; sp: { from: string; to: string; grain?: string }; extra?: string }) {
  const q = new URLSearchParams({ type, du: sp.from, au: sp.to, ...(sp.grain ? { grain: sp.grain } : {}) }).toString();
  return <a href={`/admin/rapports/export?${q}${extra}`} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">Exporter en CSV</a>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("admin.access");
  const sp = await searchParams;
  const allowed = (p: string) =>
    p === "stock" ? can(actor.roles, "reports.view") || can(actor.roles, "stock.manage")
      : p === "unpaid" ? can(actor.roles, "reports.view") || can(actor.roles, "invoices.read")
        : can(actor.roles, p as "reports.view");
  const views = VIEWS.filter(([, , p]) => allowed(p));
  if (views.length === 0) return <Alert tone="error">Votre rôle ne donne accès à aucun rapport.</Alert>;
  const view = views.find(([k]) => k === sp.vue)?.[0] ?? views[0][0];
  let range: { from: string; to: string };
  let rangeError: string | null = null;
  try { range = parseRange(sp.du, sp.au); } catch (e) { rangeError = (e as Error).message; range = parseRange(); }
  const grain = (["day", "week", "month"].includes(sp.grain ?? "") ? sp.grain : "day") as Grain;
  const dated = !["stock", "impayes"].includes(view);
  const link = (k: string) => `/admin/rapports?vue=${k}&du=${range.from}&au=${range.to}&grain=${grain}`;

  return (
    <>
      <PageHeader title="Rapports" description="Calculés en direct à partir des données enregistrées. Les montants de ventes et de chiffre d'affaires ne sont pas des bénéfices." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Rapports">
        {views.map(([k, label]) => (
          <Link key={k} href={link(k)} className={`rounded-full px-3 py-1.5 font-medium ring-1 ${view === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      {dated && (
        <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="vue" value={view} />
          <label>Du <input type="date" name="du" defaultValue={range.from} className="ms-1 rounded-lg border border-slate-300 px-2 py-1.5" /></label>
          <label>au <input type="date" name="au" defaultValue={range.to} className="ms-1 rounded-lg border border-slate-300 px-2 py-1.5" /></label>
          {view === "ventes" && (
            <label>par <select name="grain" defaultValue={grain} className="ms-1 rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="day">jour</option><option value="week">semaine</option><option value="month">mois</option>
            </select></label>
          )}
          <button className="rounded-lg bg-brand-700 px-4 py-1.5 font-semibold text-white">Afficher</button>
        </form>
      )}
      {rangeError && <div className="mb-4"><Alert tone="error">{rangeError}</Alert></div>}
      {view === "ventes" && <SalesView range={range} grain={grain} actor={actor} />}
      {view === "produits" && <ProductsView range={range} sort={sp.tri === "quantite" ? "quantity" : "revenue"} actor={actor} />}
      {view === "categories" && <CategoriesView range={range} actor={actor} />}
      {view === "stock" && <StockView actor={actor} />}
      {view === "annulations" && <CancelView range={range} actor={actor} />}
      {view === "paiements" && <PaymentsView range={range} actor={actor} />}
      {view === "impayes" && <UnpaidView actor={actor} />}
    </>
  );
}

type A = Parameters<typeof salesByPeriod>[0];
type R = { from: string; to: string };

async function SalesView({ range, grain, actor }: { range: R; grain: Grain; actor: A }) {
  const rows = await salesByPeriod(actor, range, grain);
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[["Ventes (commandes)", sum("total_minor"), `${sum("orders")} commande(s)`],
          ["dont détail", sum("retail_minor"), `${sum("retail_orders")} commande(s)`],
          ["dont professionnels", sum("business_minor"), `${sum("business_orders")} commande(s)`],
          ["CA facturé net", sum("invoiced_minor") - sum("credited_minor"), `factures ${formatMRU(sum("invoiced_minor"))} − avoirs ${formatMRU(sum("credited_minor"))}`]].map(([l, v, s]) => (
          <Card key={l as string} className="p-4"><p className="text-sm text-slate-600">{l}</p><p className="mt-1 text-xl font-bold text-brand-800">{formatMRU(v as number)}</p><p className="text-xs text-slate-500">{s}</p></Card>
        ))}
      </div>
      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold">Ventes par {grain === "day" ? "jour" : grain === "week" ? "semaine" : "mois"}</h2><Export type="ventes" sp={{ ...range, grain }} /></div>
        <PeriodChart label="Ventes TTC par période (commandes non annulées)" rows={rows.map((r) => ({ period: r.period, value: r.total_minor, sub: `${r.orders} commande(s)` }))} />
      </Card>
      <Table>
        <thead><tr><th className={th}>Période</th><th className={th}>Commandes</th><th className={th}>Ventes</th><th className={th}>Détail</th><th className={th}>Pros</th><th className={th}>Facturé</th><th className={th}>Avoirs</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.filter((r) => r.orders || r.invoiced_minor || r.credited_minor).map((r) => (
            <tr key={r.period}><td className={td}>{r.period.split("-").reverse().join("/")}</td><td className={td}>{r.orders}</td><td className={td}>{formatMRU(r.total_minor)}</td><td className={td}>{formatMRU(r.retail_minor)}</td><td className={td}>{formatMRU(r.business_minor)}</td><td className={td}>{formatMRU(r.invoiced_minor)}</td><td className={td}>{formatMRU(r.credited_minor)}</td></tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-slate-500">Ventes : commandes passées sur la période, hors annulées et retournées (livraison incluse). CA facturé : factures émises moins avoirs, par date d&apos;émission.</p>
    </div>
  );
}

async function ProductsView({ range, sort, actor }: { range: R; sort: "revenue" | "quantity"; actor: A }) {
  const rows = await salesByProduct(actor, range, sort);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>Trier par : <Link className={sort === "revenue" ? "font-semibold" : "underline"} href={`/admin/rapports?vue=produits&du=${range.from}&au=${range.to}`}>montant</Link> · <Link className={sort === "quantity" ? "font-semibold" : "underline"} href={`/admin/rapports?vue=produits&du=${range.from}&au=${range.to}&tri=quantite`}>quantité</Link></p>
        <Export type="produits" sp={range} extra={sort === "quantity" ? "&tri=quantite" : ""} />
      </div>
      {rows.length === 0 ? <EmptyState title="Aucune vente sur la période" /> : (
        <Table>
          <thead><tr><th className={th}>#</th><th className={th}>Produit</th><th className={th}>Catégorie</th><th className={th}>Quantité</th><th className={th}>Commandes</th><th className={th}>Ventes</th><th className={th}>Détail / Pros</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.product_id}><td className={td}>{i + 1}</td><td className={td}>{r.name}<div className="font-mono text-xs text-slate-400">{r.sku}</div></td><td className={td}>{r.category_name ?? "—"}</td><td className={td}>{r.quantity}</td><td className={td}>{r.orders}</td><td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(r.revenue_minor)}</td><td className={`${td} whitespace-nowrap text-xs`}>{formatMRU(r.retail_revenue_minor)} / {formatMRU(r.business_revenue_minor)}</td></tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-slate-500">Montants des lignes de commande (hors livraison), au prix effectivement facturé au client.</p>
    </div>
  );
}

async function CategoriesView({ range, actor }: { range: R; actor: A }) {
  const rows = await salesByCategory(actor, range);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Export type="categories" sp={range} /></div>
      {rows.length === 0 ? <EmptyState title="Aucune vente sur la période" /> : (
        <Table>
          <thead><tr><th className={th}>Catégorie</th><th className={th}>Quantité</th><th className={th}>Commandes</th><th className={th}>Ventes</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.category_name}><td className={td}>{r.category_name}</td><td className={td}>{r.quantity}</td><td className={td}>{r.orders}</td><td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(r.revenue_minor)}</td></tr>)}</tbody>
        </Table>
      )}
      <p className="text-xs text-slate-500">Classement selon la catégorie actuelle du produit.</p>
    </div>
  );
}

async function StockView({ actor }: { actor: A }) {
  const [rows, lots] = await Promise.all([stockReport(actor), expiringLotsReport(actor, 90)]);
  const out = rows.filter((r) => r.state === "rupture");
  const low = rows.filter((r) => r.state === "bas");
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-slate-600">Produits suivis</p><p className="text-xl font-bold">{rows.length}</p></Card>
        <Card className="p-4"><p className="text-sm text-slate-600">En rupture</p><p className="text-xl font-bold text-red-700">{out.length}</p></Card>
        <Card className="p-4"><p className="text-sm text-slate-600">Stock bas</p><p className="text-xl font-bold text-amber-700">{low.length}</p></Card>
        <Card className="p-4"><p className="text-sm text-slate-600">Lots à péremption ≤ 90 j</p><p className="text-xl font-bold text-amber-700">{lots.length}</p></Card>
      </div>
      <div className="flex flex-wrap justify-end gap-2"><Export type="stock" sp={{ from: "", to: "" }} /><a href="/admin/rapports/export?type=peremptions&jours=90" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">Exporter les péremptions (CSV)</a></div>
      <Table>
        <thead><tr><th className={th}>Produit</th><th className={th}>Physique</th><th className={th}>Réservé</th><th className={th}>Disponible</th><th className={th}>Seuil</th><th className={th}>Périmé</th><th className={th}>Prochaine péremption</th><th className={th}>État</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.sku}><td className={td}>{r.name}<div className="font-mono text-xs text-slate-400">{r.sku}</div></td><td className={td}>{r.physical}</td><td className={td}>{r.reserved}</td><td className={`${td} whitespace-nowrap font-semibold`}>{r.available}</td><td className={td}>{r.threshold}</td><td className={td}>{r.expired || "—"}</td><td className={td}>{r.next_expiry ?? "—"}</td>
              <td className={td}><Badge tone={r.state === "rupture" ? "red" : r.state === "bas" ? "amber" : "green"}>{r.state === "rupture" ? "Rupture" : r.state === "bas" ? "Stock bas" : "OK"}</Badge></td></tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

async function CancelView({ range, actor }: { range: R; actor: A }) {
  const { cancelled, returns } = await cancellationsReport(actor, range);
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">Commandes annulées ({cancelled.length} · {formatMRU(cancelled.reduce((s, c) => s + c.total_minor, 0))})</h2><Export type="annulations" sp={range} /></div>
        {cancelled.length === 0 ? <p className="text-sm text-slate-600">Aucune.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{cancelled.map((c) => <li key={c.number} className="py-2"><span className="font-mono">{c.number}</span> · {formatDateTime(c.cancelled_at)} · {c.customer} · {formatMRU(c.total_minor)}<div className="text-slate-600">{c.reason}</div></li>)}</ul>
        )}
      </Card>
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">Retours ({returns.length})</h2><Export type="retours" sp={range} /></div>
        {returns.length === 0 ? <p className="text-sm text-slate-600">Aucun.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{returns.map((r, i) => <li key={i} className="py-2"><span className="font-mono">{r.number}</span> · {formatDateTime(r.requested_at)} · {r.customer} · {r.status}{r.restocked !== null && ` · ${r.restocked ? "remis en stock" : "non remis en stock"}`}<div className="text-slate-600">{r.reason}</div></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

async function PaymentsView({ range, actor }: { range: R; actor: A }) {
  const { byMethod, pending } = await paymentsReport(actor, range);
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Export type="paiements" sp={range} /></div>
      <Table>
        <thead><tr><th className={th}>Moyen</th><th className={th}>Confirmés</th><th className={th}>Montant confirmé</th><th className={th}>Remboursé</th><th className={th}>En attente (à date)</th><th className={th}>Refusés</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{byMethod.map((m) => <tr key={m.method}><td className={td}>{m.method}</td><td className={td}>{m.confirmed_count}</td><td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(m.confirmed_minor)}</td><td className={td}>{formatMRU(m.refunded_minor)}</td><td className={td}>{m.pending_count} · {formatMRU(m.pending_minor)}</td><td className={td}>{m.refused_count}</td></tr>)}</tbody>
      </Table>
      <Card className="p-5">
        <h2 className="mb-2 font-semibold">Paiements en attente de vérification ({pending.length})</h2>
        {pending.length === 0 ? <p className="text-sm text-slate-600">Aucun.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{pending.map((p, i) => <li key={i} className="py-2">{formatDateTime(p.submitted_at)} · {p.method} · {formatMRU(p.amount_minor)} · <span className="font-mono">{p.document}</span>{p.reference && <> · réf. <span className="font-mono">{p.reference}</span></>}</li>)}</ul>
        )}
        <Link href="/admin/paiements" className="mt-2 inline-block text-sm font-semibold text-brand-700 underline">Vérifier les paiements</Link>
      </Card>
      <p className="text-xs text-slate-500">Confirmés, remboursés et refusés : selon la date de vérification. En attente : situation à cet instant.</p>
    </div>
  );
}

async function UnpaidView({ actor }: { actor: A }) {
  const { invoices, balances } = await unpaidInvoicesReport(actor);
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">Soldes clients ({formatMRU(balances.reduce((s, b) => s + b.balance_minor, 0))})</h2><Export type="soldes" sp={{ from: "", to: "" }} /></div>
        {balances.length === 0 ? <p className="text-sm text-slate-600">Aucun solde dû.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{balances.map((b) => <li key={b.customer} className="flex justify-between gap-2 py-2"><span>{b.customer} · {b.count} facture(s)</span><strong>{formatMRU(b.balance_minor)}</strong></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Solde = reste à payer des factures émises (avoirs et règlements confirmés déduits). Les commandes non encore facturées ne sont pas incluses.</p>
      </Card>
      <div className="flex justify-end"><Export type="impayes" sp={{ from: "", to: "" }} /></div>
      {invoices.length === 0 ? <EmptyState title="Aucune facture impayée" /> : (
        <Table>
          <thead><tr><th className={th}>Facture</th><th className={th}>Client</th><th className={th}>Émise</th><th className={th}>Échéance</th><th className={th}>Total</th><th className={th}>Reste dû</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{invoices.map((i) => <tr key={i.number}><td className={`${td} font-mono`}>{i.number}</td><td className={td}>{i.customer}</td><td className={td}>{i.issue_date}</td><td className={td}>{i.due_date ?? "—"}{i.days_overdue ? <div><Badge tone="red">{i.days_overdue} j de retard</Badge></div> : null}</td><td className={td}>{formatMRU(i.total_minor)}</td><td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(i.balance_minor)}</td></tr>)}</tbody>
        </Table>
      )}
    </div>
  );
}
