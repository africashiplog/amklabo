import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryForm } from "@/components/category-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { adminListCategories } from "@/server/services/catalog";

export default async function EditCategory({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionPage("catalog.manage");
  const { id } = await params;
  const categories = await adminListCategories(actor);
  const category = categories.find((c) => c.id === id);
  if (!category) notFound();
  return (
    <>
      <Link href="/admin/categories" className="text-sm text-brand-700 hover:underline">← Catégories</Link>
      <PageHeader title={category.name} description={`${category.product_count} produit(s) · adresse : /categories/${category.slug}`} />
      <Card className="max-w-xl p-6"><CategoryForm category={category} parents={categories} /></Card>
    </>
  );
}
