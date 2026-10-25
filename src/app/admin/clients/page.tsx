import { Badge, EmptyState, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDate } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { adminListCustomers } from "@/server/services/customers";

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("customers.read");
  const sp = await searchParams;
  const r = await adminListCustomers(actor, { q: sp.q, type: sp.type, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Clients" description={<>{r.total} client(s). La gestion complète (comptes professionnels, tarifs, notes, archivage) arrive en Phase 2.</>} />
      <form className="mb-4 grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0 sm:grid-cols-[1fr_12rem_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Nom, e-mail, téléphone" aria-label="Recherche" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Tous les types</option><option value="retail">Particuliers</option><option value="business">Professionnels</option>
        </select>
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
      </form>
      {r.items.length === 0 ? <EmptyState title="Aucun client" /> : (
        <Table>
          <thead><tr><th className={th}>Nom</th><th className={th}>Contact</th><th className={th}>Type</th><th className={th}>Statut</th><th className={th}>Adresses</th><th className={th}>Inscription</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.items.map((c) => (
              <tr key={c.id}>
                <td className={`${td} font-medium`}>{c.full_name}</td>
                <td className={td}><div>{c.email ?? "—"}</div><div className="text-xs text-slate-500">{c.phone}</div></td>
                <td className={td}><Badge tone={c.customer_type === "business" ? "blue" : "slate"}>{t.customerType[c.customer_type]}</Badge></td>
                <td className={td}><Badge tone={c.status === "active" ? "green" : "amber"}>{t.userStatus[c.status]}</Badge></td>
                <td className={td}>{c.address_count}</td>
                <td className={td}>{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/clients" params={{ q: sp.q, type: sp.type }} />
    </>
  );
}
