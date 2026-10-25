import Link from "next/link";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { adminListCategories, adminListProducts } from "@/server/services/catalog";
import { mediaUrl } from "@/server/storage";

const tone = { draft: "slate", published: "green", unavailable: "amber", archived: "red" } as const;

export default async function AdminProducts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("catalog.manage");
  const sp = await searchParams;
  const [result, categories] = await Promise.all([
    adminListProducts(actor, { q: sp.q, status: sp.statut, categoryId: sp.categorie, page: Number(sp.page) || 1 }),
    adminListCategories(actor),
  ]);
  return (
    <>
      <PageHeader title="Produits" description={`${result.total} produit(s)`} actions={<LinkButton href="/admin/produits/nouveau">+ Nouveau produit</LinkButton>} />
      {sp.supprime && <div className="mb-4"><Alert tone="success">Produit supprimé.</Alert></div>}
      <form className="mb-4 grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0 sm:grid-cols-[1fr_12rem_14rem_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Nom, SKU, code-barres" aria-label="Recherche" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="statut" defaultValue={sp.statut ?? ""} aria-label="Statut" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Tous les statuts</option>
          {Object.entries(t.productStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="categorie" defaultValue={sp.categorie ?? ""} aria-label="Catégorie" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "— " : ""}{c.name}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
      </form>
      {result.items.length === 0 ? <EmptyState title="Aucun produit">Créez votre premier produit pour l&apos;afficher dans le catalogue.</EmptyState> : (
        <Table>
          <thead><tr><th className={th}>Produit</th><th className={th}>SKU</th><th className={th}>Catégorie</th><th className={th}>Prix public</th><th className={th}>Statut</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {result.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className={td}>
                  <Link href={`/admin/produits/${p.id}`} className="flex items-center gap-3 font-medium text-brand-800 hover:underline">
                    {p.cover_path
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={mediaUrl(p.cover_path)} alt="" className="h-10 w-10 rounded border border-slate-200 object-contain" />
                      : <span className="h-10 w-10 rounded border border-dashed border-slate-300" />}
                    {p.name}
                  </Link>
                </td>
                <td className={`${td} font-mono text-xs`}>{p.sku}</td>
                <td className={td}>{p.category_name ?? "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{formatMRU(p.retail_price_minor)}</td>
                <td className={td}><Badge tone={tone[p.status]}>{t.productStatus[p.status]}</Badge>{p.is_featured && <span className="ms-1"><Badge tone="blue">En avant</Badge></span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} basePath="/admin/produits" params={{ q: sp.q, statut: sp.statut, categorie: sp.categorie }} />
    </>
  );
}
