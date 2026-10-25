import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { ProductSelect } from "@/components/product-select";
import { Alert, Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { listProductOptions } from "@/server/services/catalog";
import { getPurchaseOrder, PO_STATUS } from "@/server/services/purchasing";
import {
  addPoItemAction, cancelPoAction, markPoOrderedAction, receivePoAction, removePoItemAction,
} from "../../stock-actions";

const poTone = { draft: "slate", ordered: "blue", partially_received: "amber", received: "green", cancelled: "red" } as const;

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("suppliers.manage");
  const data = await getPurchaseOrder(actor, id);
  if (!data) notFound();
  const { po, items } = data;
  const isDraft = po.status === "draft";
  const receivable = (po.status === "ordered" || po.status === "partially_received") && can(actor.roles, "stock.manage");
  const showCosts = can(actor.roles, "stock.view_costs");
  const products = isDraft ? await listProductOptions(actor) : [];

  return (
    <>
      <Link href="/admin/achats" className="text-sm text-brand-700 hover:underline">← Bons d&apos;achat</Link>
      <PageHeader title={`Bon d'achat ${po.number}`}
        description={<><Badge tone={poTone[po.status]}>{PO_STATUS[po.status]}</Badge> · {po.supplier_name} · créé le {formatDate(po.created_at)} par {po.creator_name ?? "—"}
          {po.ordered_at && <> · commandé le {formatDateTime(po.ordered_at)}</>}{po.expected_at && <> · livraison prévue le {po.expected_at}</>}</>} />
      {po.notes && <p className="mb-4 whitespace-pre-line rounded-lg bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">{po.notes}</p>}

      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">Lignes</h2>
          {items.length === 0 ? <p className="text-sm text-slate-600">Aucun produit.</p> : (
            <Table>
              <thead><tr><th className={th}>Produit</th><th className={th}>Commandé</th><th className={th}>Reçu</th>{showCosts && <th className={th}>Coût unit.</th>}{showCosts && <th className={th}>Total</th>}{isDraft && <th className={th}></th>}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>{i.product_name}<div className="font-mono text-xs text-slate-400">{i.sku}{i.track_lots && " · suivi par lots"}</div></td>
                    <td className={td}>{i.qty_ordered}</td>
                    <td className={td}>{i.qty_received === i.qty_ordered ? <Badge tone="green">{i.qty_received}</Badge> : i.qty_received}</td>
                    {showCosts && <td className={td}>{i.unit_cost_minor != null ? formatMRU(i.unit_cost_minor) : "—"}</td>}
                    {showCosts && <td className={td}>{i.unit_cost_minor != null ? formatMRU(i.unit_cost_minor * i.qty_ordered) : "—"}</td>}
                    {isDraft && <td className={td}><ConfirmAction action={removePoItemAction} fields={{ itemId: i.id }} label="Retirer"
                      title="Retirer cette ligne ?" description={i.product_name} confirmLabel="Retirer" /></td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {showCosts && po.total_cost_minor != null && <p className="text-end text-sm">Total estimé : <strong>{formatMRU(po.total_cost_minor)}</strong></p>}
          {isDraft && (
            <ActionForm action={addPoItemAction} resetOnSuccess>
              <input type="hidden" name="poId" value={po.id} />
              <ProductSelect products={products} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="quantity" label="Quantité (unités de vente)" type="number" min={1} required />
                <Field name="unitCost" label="Coût unitaire (MRU)" hint="(facultatif)" inputMode="decimal" />
              </div>
              <SubmitButton size="sm" variant="secondary">Ajouter / mettre à jour la ligne</SubmitButton>
            </ActionForm>
          )}
        </Card>

        {receivable && (
          <Card className="p-6">
            <h2 className="mb-1 font-semibold">Réception</h2>
            <p className="mb-4 text-xs text-slate-500">Saisissez les quantités effectivement reçues. Un lot est créé par ligne ; le numéro de lot et la péremption sont obligatoires pour les produits suivis par lots.</p>
            <ActionForm action={receivePoAction}>
              <input type="hidden" name="poId" value={po.id} />
              <div className="space-y-3">
                {items.filter((i) => i.qty_received < i.qty_ordered).map((i) => (
                  <fieldset key={i.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_7rem_9rem_10rem]">
                    <legend className="sr-only">{i.product_name}</legend>
                    <input type="hidden" name="itemId" value={i.id} />
                    <p className="text-sm font-medium">{i.product_name}<span className="block text-xs font-normal text-slate-500">reste {i.qty_ordered - i.qty_received}</span></p>
                    <input name="quantity" type="number" min={0} max={i.qty_ordered - i.qty_received} aria-label={`Quantité reçue — ${i.product_name}`} placeholder="Qté reçue" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <input name="lotNumber" aria-label={`N° de lot — ${i.product_name}`} placeholder={i.track_lots ? "N° lot (requis)" : "N° lot"} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <input name="expiryDate" type="date" aria-label={`Péremption — ${i.product_name}`} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                  </fieldset>
                ))}
              </div>
              <SubmitButton variant="success" pendingLabel="Enregistrement…">Enregistrer la réception</SubmitButton>
            </ActionForm>
          </Card>
        )}
        {(po.status === "ordered" || po.status === "partially_received") && !can(actor.roles, "stock.manage") && (
          <Alert tone="info">La réception est réservée au gestionnaire de stock.</Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <ConfirmAction action={markPoOrderedAction} fields={{ poId: po.id }} label="Valider la commande" variant="primary" size="md"
              title={`Valider ${po.number} ?`} confirmLabel="Valider"
              description="Le bon d'achat passera à l'état « Commandé » et ses lignes ne seront plus modifiables. Pensez à le transmettre au fournisseur." />
          )}
          {(isDraft || po.status === "ordered") && (
            <ConfirmAction action={cancelPoAction} fields={{ poId: po.id }} label="Annuler le bon d'achat" size="md"
              title={`Annuler ${po.number} ?`} confirmLabel="Annuler le bon d'achat"
              description="Le bon d'achat sera conservé avec le statut « Annulé ». Son numéro n'est pas réutilisé.">
              <Field name="reason" label="Motif" required />
            </ConfirmAction>
          )}
        </div>
      </div>
    </>
  );
}
