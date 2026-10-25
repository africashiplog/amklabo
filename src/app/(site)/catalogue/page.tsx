import type { Metadata } from "next";
import { CatalogueView, type CatalogueParams } from "@/components/catalogue-view";

export const metadata: Metadata = { title: "Catalogue" };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<CatalogueParams> }) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-slate-900">Catalogue</h1>
      <CatalogueView params={params} basePath="/catalogue" />
    </div>
  );
}
