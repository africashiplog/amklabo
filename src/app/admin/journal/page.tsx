import { EmptyState, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { listAuditLogs } from "@/server/services/dashboard";

function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (before == null && after == null) return <span className="text-slate-400">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-brand-700">Détails</summary>
      <pre className="mt-2 max-h-64 max-w-xl overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-snug">
        {before != null && `Avant : ${JSON.stringify(before, null, 1)}\n`}
        {after != null && `Après : ${JSON.stringify(after, null, 1)}`}
      </pre>
    </details>
  );
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("audit.read");
  const sp = await searchParams;
  const r = await listAuditLogs(actor, { action: sp.action, entity: sp.entite, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Journal d'audit" description="Lecture seule. La base de données refuse toute modification ou suppression des entrées." />
      <form className="mb-4 grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0 sm:grid-cols-[1fr_1fr_auto]">
        <input name="action" defaultValue={sp.action} placeholder="Action (ex. product.price_change)" aria-label="Action" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="entite" defaultValue={sp.entite} placeholder="Identifiant de l'élément" aria-label="Identifiant" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
      </form>
      {r.items.length === 0 ? <EmptyState title="Aucune entrée" /> : (
        <Table>
          <thead><tr><th className={th}>Date</th><th className={th}>Utilisateur</th><th className={th}>Action</th><th className={th}>Élément</th><th className={th}>Données</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.items.map((a) => (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(a.created_at)}</td>
                <td className={td}>{a.actor_email ?? "—"}{a.ip && <div className="text-xs text-slate-400">{a.ip}</div>}</td>
                <td className={td}><code className="text-xs text-brand-800">{a.action}</code></td>
                <td className={td}><span className="text-xs">{a.entity_type}</span><div className="max-w-[10rem] truncate font-mono text-[11px] text-slate-400">{a.entity_id}</div></td>
                <td className={td}><Diff before={a.before_data} after={a.after_data} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/journal" params={{ action: sp.action, entite: sp.entite }} />
    </>
  );
}
