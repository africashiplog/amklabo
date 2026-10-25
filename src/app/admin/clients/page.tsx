import Link from "next/link";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDate } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { BUSINESS_STATUS } from "@/server/services/business";
import { adminListCustomers } from "@/server/services/customers";

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("customers.read");
  const sp = await searchParams;
  const r = await adminListCustomers(actor, { q: sp.q, type: sp.type, status: sp.statut, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Clients" description={`${r.total} client(s)`}
        actions={can(actor.roles, "customers.manage") && <LinkButton href="/admin/clients/nouveau">+ Nouveau client</LinkButton>} />
      {sp.supprime && <div className="mb-4"><Alert tone="success">Client supprimé définitivement.</Alert></div>}
      <form className="mb-4 grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0 sm:grid-cols-[1fr_11rem_11rem_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Nom, établissement, e-mail, téléphone" aria-label="Recherche" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Tous les types</option><option value="retail">Particuliers</option><option value="business">Professionnels</option>
        </select>
        <select name="statut" defaultValue={sp.statut ?? ""} aria-label="Statut" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Actifs et suspendus</option><option value="active">Actifs</option><option value="suspended">Suspendus</option><option value="archived">Archivés</option>
        </select>
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
      </form>
      {r.items.length === 0 ? <EmptyState title="Aucun client" /> : (
        <Table>
          <thead><tr><th className={th}>Nom</th><th className={th}>Contact</th><th className={th}>Type</th><th className={th}>Statut</th><th className={th}>Inscription</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className={td}>
                  <Link href={`/admin/clients/${c.id}`} className="font-medium text-brand-800 hover:underline">{c.full_name}</Link>
                  {!c.has_account && <div className="text-xs text-slate-400">sans compte en ligne</div>}
                </td>
                <td className={td}><div>{c.email ?? "—"}</div><div className="text-xs text-slate-500">{c.phone}</div></td>
                <td className={td}>
                  <Badge tone={c.customer_type === "business" ? "blue" : "slate"}>{t.customerType[c.customer_type]}</Badge>
                  {c.business_status && <div className="mt-1 text-xs text-slate-500">Pro : {BUSINESS_STATUS[c.business_status as keyof typeof BUSINESS_STATUS]}</div>}
                </td>
                <td className={td}><Badge tone={c.status === "active" ? "green" : "amber"}>{t.userStatus[c.status]}</Badge></td>
                <td className={td}>{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/clients" params={{ q: sp.q, type: sp.type, statut: sp.statut }} />
    </>
  );
}
