import Link from "next/link";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { adminListCategories } from "@/server/services/catalog";
import { createProductAction } from "../../actions";

export default async function NewProduct() {
  const actor = await requirePermissionPage("catalog.manage");
  const categories = await adminListCategories(actor);
  return (
    <>
      <Link href="/admin/produits" className="text-sm text-brand-700 hover:underline">← Produits</Link>
      <PageHeader title="Nouveau produit" description="Les images pourront être ajoutées après la création." />
      <ProductForm action={createProductAction} categories={categories} />
    </>
  );
}
