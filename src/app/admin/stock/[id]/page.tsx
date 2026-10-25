import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { listSupplierOptions } from "@/server/services/purchasing";
import { getProductStock, MOVEMENT_LABELS } from "@/server/services/stock";
import { stockCountAction, stockEntryAction, stockExitAction } from "../../stock-actions";

const today = () => new Date().toISOString().slice(0, 10);

export default async function ProductStockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("stock.manage");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getProductStock(actor, id);
  if (!data) notFound();
  const { product: p, lots, movements } = data;
  const suppliers = await listSupplierOptions(actor);
  const showCosts = can(actor.roles, "stock.view_costs");
  const activeLots = lots.filter((l) => l.qty_on_hand > 0);

  return (
    <>
      <Link href="/admin/stock" className="text-sm text-brand-700 hover:underline">← Stock</Link>
      <PageHeader title={p.name}
        description={<><span className="font-mono">{p.sku}</span> · disponible : <strong>{p.on_hand}</strong> · seuil d&apos;alerte : {p.stock_alert_threshold}{p.track_lots ? " · suivi par lots" : ""}{p.expired_qty > 0 && <> · <span className="text-red-700">{p.expired_qty} en lots périmés</span></>}</>}
        actions={can(actor.roles, "catalog.manage") && <Link href={`/admin/produits/${p.id}`} className="text-sm font-semibold text-brand-700 hover:underline">Fiche produit →</Link>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 font-semibold">Lots</h2>
            {lots.length === 0 ? <Card className="p-5 text-sm text-slate-600">Aucun stock enregistré.</Card> : (
              <Table>
                <thead><tr><th className={th}>Lot</th><th className={th}>Péremption</th><th className={th}>Quantité</th><th className={th}>Origine</th>{showCosts && <th className={th}>Coût unit.</th>}<th className={th}>Inventaire</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lots.map((l) => {
                    const expired = l.expiry_date !== null && l.expiry_date < today();
                    return (
                      <tr key={l.id} className={l.qty_on_hand === 0 ? "text-slate-400" : ""}>
                        <td className={`${td} font-mono text-xs`}>{l.lot_number ?? "—"}</td>
                        <td className={td}>{l.expiry_date ?? "—"} {expired && l.qty_on_hand > 0 && <Badge tone="red">Périmé</Badge>}</td>
                        <td className={`${td} font-semibold`}>{l.qty_on_hand}</td>
                        <td className={`${td} text-xs`}>{l.po_number ?? "Entrée manuelle"}<div className="text-slate-400">{l.supplier_name ?? ""} · {formatDate(l.received_at)}</div></td>
                        {showCosts && <td className={td}>{l.unit_cost_minor != null ? formatMRU(l.unit_cost_minor) : "—"}</td>}
                        <td className={td}>
                          <ActionForm action={stockCountAction} className="flex flex-wrap items-end gap-1 space-y-0" showSuccess={false}>
                            <input type="hidden" name="lotId" value={l.id} />
                            <input name="counted" type="number" min={0} aria-label="Quantité comptée" placeholder="Compté" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                            <input name="reason" aria-label="Motif" placeholder="Motif" className="w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
                            <SubmitButton size="sm" variant="secondary" pendingLabel="…">OK</SubmitButton>
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Historique des mouvements</h2>
            <p className="mb-2 text-xs text-slate-500">Historique immuable : aucun mouvement ne peut être modifié ou supprimé.</p>
            {movements.length === 0 ? <Card className="p-5 text-sm text-slate-600">Aucun mouvement.</Card> : (
              <Table>
                <thead><tr><th className={th}>Date</th><th className={th}>Type</th><th className={th}>Lot</th><th className={th}>Qté</th><th className={th}>Solde lot</th><th className={th}>Motif / auteur</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(m.created_at)}</td>
                      <td className={td}>{MOVEMENT_LABELS[m.movement_type]}</td>
                      <td className={`${td} font-mono text-xs`}>{m.lot_number ?? "—"}</td>
                      <td className={`${td} font-semibold ${m.quantity > 0 ? "text-leaf-700" : "text-red-700"}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                      <td className={td}>{m.balance_after}</td>
                      <td className={`${td} text-xs`}>{m.reason}<div className="text-slate-400">{m.author ?? "—"}</div></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Entrée de stock</h2>
            <p className="mb-3 text-xs text-slate-500">Les réceptions fournisseurs se font de préférence depuis un bon d&apos;achat.</p>
            <ActionForm action={stockEntryAction} resetOnSuccess>
              <input type="hidden" name="productId" value={p.id} />
              <div className="grid grid-cols-2 gap-2">
                <Field name="type" label="Type" as="select" className="col-span-2">
                  <option value="manual_in">Entrée manuelle</option><option value="return_in">Retour client</option>
                </Field>
                <Field name="quantity" label="Quantité" type="number" min={1} required />
                <Field name="lotNumber" label="N° de lot" hint={p.track_lots ? "(requis)" : undefined} />
                <Field name="expiryDate" label="Péremption" type="date" hint={p.track_lots ? "(requise)" : undefined} className="col-span-2" />
                <Field name="supplierId" label="Fournisseur" as="select" className="col-span-2">
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Field>
                {showCosts && <Field name="unitCost" label="Coût unitaire (MRU)" inputMode="decimal" className="col-span-2" />}
              </div>
              <Field name="reason" label="Motif" required />
              <SubmitButton size="sm" variant="success">Enregistrer l&apos;entrée</SubmitButton>
            </ActionForm>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Sortie de stock</h2>
            <ActionForm action={stockExitAction} resetOnSuccess>
              <input type="hidden" name="productId" value={p.id} />
              <Field name="type" label="Type" as="select">
                <option value="adjustment_out">Ajustement (−)</option>
                <option value="loss">Perte / casse</option>
                <option value="expiry_writeoff">Mise au rebut (péremption)</option>
                <option value="return_to_supplier">Retour fournisseur</option>
              </Field>
              <Field name="lotId" label="Lot" as="select" hint="(vide = lot qui périme le plus tôt)">
                <option value="">Automatique (FEFO)</option>
                {activeLots.map((l) => <option key={l.id} value={l.id}>{l.lot_number ?? "sans n°"} — {l.qty_on_hand} — {l.expiry_date ?? "sans date"}</option>)}
              </Field>
              <Field name="quantity" label="Quantité" type="number" min={1} required />
              <Field name="reason" label="Motif" required />
              <SubmitButton size="sm" variant="danger">Enregistrer la sortie</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
