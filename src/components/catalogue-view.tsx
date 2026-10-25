import Link from "next/link";
import { ProductCard } from "./product-card";
import { cx, EmptyState, Pagination } from "./ui";
import { getActor } from "@/server/current";
import { enrichProducts } from "@/server/services/storefront";
import { listPublicBrands, listPublicCategories, searchPublicProducts, SORTS, type SortKey } from "@/server/services/catalog";

export type CatalogueParams = { q?: string; categorie?: string; marque?: string; tri?: string; page?: string };

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Plus récents",
  name: "Nom (A → Z)",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
};

/** Catalogue filtrable. Tous les filtres passent par l'URL (liens partageables). */
export async function CatalogueView({ params, basePath, fixedCategory }: {
  params: CatalogueParams; basePath: string; fixedCategory?: string;
}) {
  const category = fixedCategory ?? params.categorie;
  const sort = (params.tri && params.tri in SORTS ? params.tri : "recent") as SortKey;
  const page = Number(params.page) || 1;
  const [result, categories, brands] = await Promise.all([
    searchPublicProducts({ q: params.q, category, brand: params.marque, sort, page }),
    listPublicCategories(),
    listPublicBrands(),
  ]);
  const { prices, stock } = await enrichProducts(await getActor(), result.items);
  const top = categories.filter((c) => !c.parent_id);
  const keep = { q: params.q, marque: params.marque, tri: params.tri, categorie: fixedCategory ? undefined : params.categorie };

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-6">
        <form action={basePath} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label htmlFor="f-q" className="mb-1 block text-sm font-medium text-slate-700">Recherche</label>
            <input id="f-q" name="q" defaultValue={params.q} type="search" placeholder="Nom, référence, marque"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
          {!fixedCategory && (
            <div>
              <label htmlFor="f-cat" className="mb-1 block text-sm font-medium text-slate-700">Catégorie</label>
              <select id="f-cat" name="categorie" defaultValue={params.categorie ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Toutes</option>
                {top.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    <option value={c.slug}>{c.name}</option>
                    {categories.filter((k) => k.parent_id === c.id).map((k) => <option key={k.id} value={k.slug}>— {k.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {brands.length > 0 && (
            <div>
              <label htmlFor="f-brand" className="mb-1 block text-sm font-medium text-slate-700">Marque</label>
              <select id="f-brand" name="marque" defaultValue={params.marque ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Toutes</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="f-sort" className="mb-1 block text-sm font-medium text-slate-700">Trier par</label>
            <select id="f-sort" name="tri" defaultValue={sort} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">Appliquer</button>
            <Link href={basePath} className="rounded-lg px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Effacer</Link>
          </div>
        </form>
        {!fixedCategory && (
          <nav aria-label="Catégories" className="hidden rounded-xl border border-slate-200 bg-white p-4 lg:block">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Catégories</h2>
            <ul className="space-y-1 text-sm">
              {top.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.slug}`} className={cx("flex justify-between rounded px-2 py-1 hover:bg-brand-50",
                    category === c.slug ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-700")}>
                    <span>{c.name}</span><span className="text-slate-400">{c.product_count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
      <section aria-live="polite">
        <p className="mb-4 text-sm text-slate-600">
          {result.total} produit{result.total > 1 ? "s" : ""}{params.q ? <> pour « <strong>{params.q}</strong> »</> : null}
        </p>
        {result.items.length === 0 ? (
          <EmptyState title="Aucun produit trouvé">
            Essayez d&apos;autres mots-clés ou <Link href="/contact" className="font-semibold text-brand-700 underline">contactez-nous</Link> pour une demande spécifique.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {result.items.map((p) => <ProductCard key={p.id} product={p} price={prices.get(p.id)} stock={stock.get(p.id)} />)}
          </div>
        )}
        <Pagination page={result.page} pageCount={result.pageCount} params={keep} basePath={basePath} />
      </section>
    </div>
  );
}
