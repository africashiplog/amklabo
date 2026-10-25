import Link from "next/link";
import { CategoryForm } from "@/components/category-form";
import { ConfirmAction, InlineAction } from "@/components/forms";
import { Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { adminListCategories, type CategoryWithCount } from "@/server/services/catalog";
import { deleteCategoryAction, moveCategoryAction } from "../actions";

function Row({ c, depth }: { c: CategoryWithCount; depth: number }) {
  const blocked = c.product_count > 0 || c.child_count > 0;
  return (
    <tr className="hover:bg-slate-50">
      <td className={td}>
        <span style={{ paddingInlineStart: depth * 20 }} className="flex items-center gap-2">
          {depth > 0 && <span className="text-slate-400">↳</span>}
          <Link href={`/admin/categories/${c.id}`} className="font-medium text-brand-800 hover:underline">{c.name}</Link>
        </span>
      </td>
      <td className={td}>{c.product_count}</td>
      <td className={td}>{c.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
      <td className={`${td} whitespace-nowrap`}>
        <div className="flex flex-wrap items-center gap-1">
          <InlineAction action={moveCategoryAction} fields={{ id: c.id, direction: "up" }}>↑</InlineAction>
          <InlineAction action={moveCategoryAction} fields={{ id: c.id, direction: "down" }}>↓</InlineAction>
          <Link href={`/admin/categories/${c.id}`} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">Modifier</Link>
          <ConfirmAction action={deleteCategoryAction} fields={{ id: c.id }} label="Supprimer"
            title={`Supprimer « ${c.name} » ?`}
            description={blocked
              ? <>Cette catégorie contient {c.product_count} produit(s) et {c.child_count} sous-catégorie(s) : la suppression sera refusée. Désactivez-la ou déplacez son contenu.</>
              : <>La catégorie sera définitivement supprimée. Cette action est enregistrée dans le journal d&apos;audit.</>}
            confirmLabel="Supprimer" />
        </div>
      </td>
    </tr>
  );
}

export default async function AdminCategories() {
  const actor = await requirePermissionPage("catalog.manage");
  const categories = await adminListCategories(actor);
  const top = categories.filter((c) => !c.parent_id);
  return (
    <>
      <PageHeader title="Catégories" description="Deux niveaux : catégories principales et sous-catégories. Les flèches modifient l'ordre d'affichage." />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Table>
          <thead><tr><th className={th}>Nom</th><th className={th}>Produits</th><th className={th}>État</th><th className={th}>Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {top.flatMap((c) => [
              <Row key={c.id} c={c} depth={0} />,
              ...categories.filter((k) => k.parent_id === c.id).map((k) => <Row key={k.id} c={k} depth={1} />),
            ])}
          </tbody>
        </Table>
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">Nouvelle catégorie</h2>
          <CategoryForm parents={categories} />
        </Card>
      </div>
    </>
  );
}
