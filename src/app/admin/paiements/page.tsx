import Link from "next/link";
import { PaymentItem } from "@/components/payment-panel";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { adminListPayments, PAYMENT_RECORD_STATUS } from "@/server/services/payments";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ statut?: string; q?: string }> }) {
  const actor = await requirePermissionPage("payments.view");
  const sp = await searchParams;
  const status = sp.statut ?? "pending_verification";
  const rows = await adminListPayments(actor, { status: status === "all" ? undefined : status, q: sp.q });
  const canVerify = can(actor.roles, "payments.verify");
  return (
    <>
      <PageHeader title="Paiements"
        description="Aucune intégration officielle des opérateurs n'est active : chaque paiement est vérifié manuellement sur le compte marchand avant confirmation." />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm">
        {[...Object.entries(PAYMENT_RECORD_STATUS), ["all", "Tous"]].map(([k, label]) => (
          <Link key={k} href={`/admin/paiements?statut=${k}`}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${status === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      <form className="mb-4 flex gap-2">
        <input type="hidden" name="statut" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Référence, commande, facture, client" aria-label="Recherche" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Rechercher</button>
      </form>
      {rows.length === 0 ? <EmptyState title="Aucun paiement" /> : (
        <div className="space-y-3">{rows.map((p) => <PaymentItem key={p.id} p={p} canVerify={canVerify} showTarget />)}</div>
      )}
    </>
  );
}
