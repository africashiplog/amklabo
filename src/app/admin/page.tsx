import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDateTime } from "@/lib/format";
import { requireActorPage } from "@/server/current";
import { can } from "@/server/permissions";
import { getDashboardStats } from "@/server/services/dashboard";

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
  ["Chiffre d'affaires et commandes", "Phase 3 — commandes"],
  ["Ventes en gros / au détail", "Phase 2–3 — comptes professionnels et commandes"],
  ["Stock, ruptures et péremptions", "Phase 2 — lots et mouvements de stock"],
  ["Paiements à vérifier", "Phase 4 — paiements"],
  ["Factures impayées", "Phase 3 — factures"],
] as const;

export default async function AdminDashboard() {
  const actor = await requireActorPage("/admin");
  if (!can(actor.roles, "dashboard.view")) redirect("/acces-refuse");
  const { counts: c, recentCustomers, recentActivity } = await getDashboardStats(actor);

  return (
    <>
      <PageHeader title="Tableau de bord" description="Indicateurs calculés en temps réel à partir de la base de données." />
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

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
