import type { Metadata } from "next";
import Link from "next/link";
import { listPublicCategories } from "@/server/services/catalog";

export const metadata: Metadata = { title: "Catégories" };

export default async function CategoriesPage() {
  const categories = await listPublicCategories();
  const top = categories.filter((c) => !c.parent_id);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-slate-900">Catégories</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {top.map((c) => {
          const children = categories.filter((k) => k.parent_id === c.id);
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <Link href={`/categories/${c.slug}`} className="text-lg font-semibold text-slate-900 hover:text-brand-700">{c.name}</Link>
              <p className="mt-1 text-sm text-slate-500">{c.product_count} produit{c.product_count > 1 ? "s" : ""}</p>
              {c.description && <p className="mt-2 text-sm text-slate-600">{c.description}</p>}
              {children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {children.map((k) => (
                    <li key={k.id}><Link href={`/categories/${k.slug}`} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100">{k.name}</Link></li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
