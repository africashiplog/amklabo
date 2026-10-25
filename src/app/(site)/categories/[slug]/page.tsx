import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogueView, type CatalogueParams } from "@/components/catalogue-view";
import { getPublicCategory, listPublicCategories } from "@/server/services/catalog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<CatalogueParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cat = await getPublicCategory((await params).slug);
  return { title: cat?.name ?? "Catégorie" };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const category = await getPublicCategory(slug);
  if (!category) notFound();
  const all = await listPublicCategories();
  const parent = category.parent_id ? all.find((c) => c.id === category.parent_id) : null;
  const children = all.filter((c) => c.parent_id === category.id);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Fil d'Ariane" className="mb-3 text-sm text-slate-500">
        <Link href="/categories" className="hover:text-brand-700">Catégories</Link>
        {parent && <> / <Link href={`/categories/${parent.slug}`} className="hover:text-brand-700">{parent.name}</Link></>}
      </nav>
      <h1 className="text-3xl font-bold text-slate-900">{category.name}</h1>
      {category.description && <p className="mt-2 max-w-3xl text-slate-600">{category.description}</p>}
      {children.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {children.map((k) => (
            <li key={k.id}><Link href={`/categories/${k.slug}`} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-slate-200 hover:bg-brand-50">{k.name}</Link></li>
          ))}
        </ul>
      )}
      <div className="mt-8">
        <CatalogueView params={await searchParams} basePath={`/categories/${slug}`} fixedCategory={slug} />
      </div>
    </div>
  );
}
