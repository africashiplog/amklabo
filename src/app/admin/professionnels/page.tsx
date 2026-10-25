import Link from "next/link";
import { BusinessReviewButtons } from "@/components/business-review";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { ACTIVITIES, BUSINESS_STATUS, adminListBusinessAccounts } from "@/server/services/business";

const tone = { pending: "amber", approved: "green", rejected: "red", suspended: "red" } as const;

export default async function BusinessAccountsPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await requirePermissionPage("customers.read");
  const { statut } = await searchParams;
  const rows = await adminListBusinessAccounts(actor, statut ?? "pending");
  const canReview = can(actor.roles, "business.approve");
  const tabs = [["pending", "En attente"], ["approved", "Approuvés"], ["suspended", "Suspendus"], ["rejected", "Refusés"], ["all", "Tous"]];

  return (
    <>
      <PageHeader title="Comptes professionnels" description="Les tarifs de gros ne sont accessibles qu'aux comptes approuvés." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filtrer par statut">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/admin/professionnels?statut=${k}`}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${(statut ?? "pending") === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState title="Aucune demande" /> : (
        <ul className="space-y-4">
          {rows.map((b) => (
            <li key={b.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">{b.establishment_name} <Badge tone={tone[b.status]}>{BUSINESS_STATUS[b.status]}</Badge></p>
                    <p className="text-sm text-slate-600">{ACTIVITIES[b.activity]} · {b.city} · demande du {formatDateTime(b.submitted_at)}</p>
                  </div>
                  <Link href={`/admin/clients/${b.customer_id}`} className="text-sm font-semibold text-brand-700 hover:underline">Fiche client →</Link>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="inline text-slate-500">Contact : </dt><dd className="inline">{b.contact_name} · {b.phone}{b.email ? ` · ${b.email}` : ""}</dd></div>
                  <div><dt className="inline text-slate-500">Adresse : </dt><dd className="inline">{b.address_line}</dd></div>
                  <div><dt className="inline text-slate-500">Identifiant pro : </dt><dd className="inline">{b.professional_id ?? "non fourni"}</dd></div>
                  <div><dt className="inline text-slate-500">Compte : </dt><dd className="inline">{b.customer_name} {b.customer_email && `(${b.customer_email})`}</dd></div>
                </dl>
                {b.message && <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{b.message}</p>}
                {b.reviewed_at && (
                  <p className="mt-2 text-xs text-slate-500">Décision du {formatDateTime(b.reviewed_at)} par {b.reviewer_name ?? "—"}{b.decision_reason ? ` — motif : ${b.decision_reason}` : ""}</p>
                )}
                {canReview && <div className="mt-3"><BusinessReviewButtons id={b.id} status={b.status} name={b.establishment_name} /></div>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
