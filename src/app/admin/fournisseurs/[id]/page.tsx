import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { ProductSelect } from "@/components/product-select";
import { SupplierForm } from "@/components/supplier-form";
import { Card, PageHeader, Table, td, th } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { listProductOptions } from "@/server/services/catalog";
import { getSupplier } from "@/server/services/purchasing";
import { linkProductSupplierAction, unlinkProductSupplierAction } from "../../stock-actions";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("suppliers.manage");
  const data = await getSupplier(actor, id);
  if (!data) notFound();
  const products = await listProductOptions(actor);
  const showCosts = can(actor.roles, "stock.view_costs");
  return (
    <>
      <Link href="/admin/fournisseurs" className="text-sm text-brand-700 hover:underline">← Fournisseurs</Link>
      <PageHeader title={data.supplier.name} actions={<Link href={`/admin/achats?fournisseur=${id}`} className="text-sm font-semibold text-brand-700 hover:underline">Bons d&apos;achat →</Link>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6"><SupplierForm supplier={data.supplier} /></Card>
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">Produits fournis</h2>
          {data.products.length === 0 ? <p className="text-sm text-slate-600">Aucun produit associé.</p> : (
            <Table>
              <thead><tr><th className={th}>Produit</th><th className={th}>Réf. fournisseur</th>{showCosts && <th className={th}>Dernier coût</th>}<th className={th}></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.products.map((p) => (
                  <tr key={p.product_id}>
                    <td className={td}>{p.name}<div className="font-mono text-xs text-slate-400">{p.sku}</div></td>
                    <td className={td}>{p.supplier_sku ?? "—"}</td>
                    {showCosts && <td className={td}>{p.last_cost_minor != null ? formatMRU(p.last_cost_minor) : "—"}</td>}
                    <td className={td}><ConfirmAction action={unlinkProductSupplierAction} fields={{ supplierId: id, productId: p.product_id }} label="Retirer"
                      title="Retirer l'association ?" description={`${p.name} ne sera plus associé à ce fournisseur (l'historique des achats est conservé).`} confirmLabel="Retirer" /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <ActionForm action={linkProductSupplierAction} resetOnSuccess>
            <input type="hidden" name="supplierId" value={id} />
            <ProductSelect products={products} />
            <Field name="supplierSku" label="Référence chez le fournisseur" hint="(facultatif)" />
            <SubmitButton size="sm" variant="secondary">Associer</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
