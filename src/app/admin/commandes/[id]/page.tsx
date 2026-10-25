import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction, Field, InlineAction } from "@/components/forms";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-badges";
import { Alert, Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { INVOICE_STATUS } from "@/server/services/invoices";
import { adminGetOrder, ORDER_STATUS, TRANSITIONS } from "@/server/services/orders";
import { DeliveryBadge } from "@/components/delivery-badge";
import { PaymentPanel } from "@/components/payment-panel";
import { getShipmentForOrder } from "@/server/services/deliveries";
import { adminListMethods, listPaymentsFor, orderAmountDue } from "@/server/services/payments";
import { query as dbQuery } from "@/server/db";
import {
  changeOrderStatusAction, completeReturnAction, createInvoiceFromOrderAction, decideReturnAction, rejectCancelRequestAction,
} from "../../order-actions";

const HINT: Partial<Record<string, string>> = {
  ready_to_ship: "Les quantités réservées sortent du stock (mouvement « Vente ») : cette étape n'est plus annulable.",
  cancelled: "Les quantités réservées sont libérées. Le client est notifié.",
  out_for_delivery: "La livraison associée passe « En cours ». Préférez la gestion depuis la page Livraison (affectation du livreur, encaissement).",
  delivered: "Le délai de demande de retour démarre. Pour un paiement à la livraison, enregistrez l'encaissement depuis la page Livraison.",
};

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("orders.read");
  const data = await adminGetOrder(actor, id);
  if (!data) notFound();
  const { order: o, items, history, returns, invoices, reservations, canManage } = data;
  const next = TRANSITIONS[o.status];
  const canPayments = can(actor.roles, "payments.view");
  const [payments, due, shipment, methods] = await Promise.all([
    canPayments ? listPaymentsFor(actor, { orderId: o.id }) : Promise.resolve([]),
    orderAmountDue(undefined, o.id),
    getShipmentForOrder(o.id),
    can(actor.roles, "settings.manage") ? adminListMethods(actor) : dbQuery<import("@/server/services/payments").PaymentMethod>("SELECT * FROM payment_methods ORDER BY sort_order"),
  ]);
  const methodName = methods.find((m) => m.code === o.payment_method_code)?.name ?? "—";
  const canInvoice = can(actor.roles, "invoices.manage") && !["new", "pending_confirmation", "cancelled"].includes(o.status)
    && !invoices.some((i) => i.kind === "invoice" && i.status !== "cancelled");

  return (
    <>
      <Link href="/admin/commandes" className="text-sm text-brand-700 hover:underline">← Commandes</Link>
      <PageHeader title={`Commande ${o.number}`}
        description={<><OrderStatusBadge status={o.status} /> <PaymentStatusBadge status={o.payment_status} /> · passée le {formatDateTime(o.placed_at)}</>} />
      {o.cancel_requested_at && (
        <div className="mb-4"><Alert tone="warning">
          <strong>Demande d&apos;annulation du client</strong> ({formatDateTime(o.cancel_requested_at)}) : {o.cancel_request_reason}
          {canManage && (
            <span className="mt-2 flex flex-wrap gap-2">
              <ConfirmAction action={changeOrderStatusAction} fields={{ orderId: o.id, to: "cancelled", note: `Annulation acceptée : ${o.cancel_request_reason ?? ""}` }}
                label="Accepter l'annulation" title={`Annuler ${o.number} ?`} confirmLabel="Annuler la commande" description={HINT.cancelled} />
              <ConfirmAction action={rejectCancelRequestAction} fields={{ orderId: o.id }} label="Refuser la demande" variant="secondary"
                title="Refuser la demande d'annulation" confirmLabel="Refuser" description="La commande poursuit son traitement ; le client reçoit votre réponse.">
                <Field name="note" label="Réponse au client" as="textarea" rows={2} required />
              </ConfirmAction>
            </span>
          )}
        </Alert></div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Table>
            <thead><tr><th className={th}>Produit</th><th className={th}>Qté</th><th className={th}>Prix unitaire</th><th className={th}>Tarif appliqué</th><th className={th}>Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className={td}>{i.name}<div className="font-mono text-xs text-slate-400">{i.sku}</div></td>
                  <td className={td}>{i.quantity}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatMRU(i.unit_price_minor)}<div className="text-xs text-slate-400">public : {formatMRU(i.retail_unit_price_minor)}</div></td>
                  <td className={`${td} text-xs`}>{i.price_label}</td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(i.line_total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          {canPayments && (
            <PaymentPanel target={{ orderId: o.id }} payments={payments} methods={methods} dueMinor={due}
              canVerify={can(actor.roles, "payments.verify")} canRefund={can(actor.roles, "payments.refund")} />
          )}

          <Card className="p-5">
            <h2 className="mb-2 font-semibold">Stock</h2>
            <p className="mb-2 text-xs text-slate-500">{o.stock_consumed_at ? `Sorti du stock le ${formatDateTime(o.stock_consumed_at)}.` : "Quantités réservées (non disponibles à la vente) jusqu'à la préparation ou l'annulation."}</p>
            <ul className="space-y-1 text-sm">
              {reservations.map((r, k) => (
                <li key={k}>{r.name} — lot {r.lot_number ?? "sans n°"}{r.expiry_date ? ` (péremption ${r.expiry_date})` : ""} : {r.quantity} <Badge tone={r.status === "active" ? "amber" : r.status === "consumed" ? "green" : "slate"}>{{ active: "réservé", consumed: "sorti", released: "libéré" }[r.status as "active"]}</Badge></li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Historique</h2>
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id}><span className="text-slate-500">{formatDateTime(h.created_at)}</span> — {h.from_status === h.to_status ? "Information" : <>{h.from_status ? `${ORDER_STATUS[h.from_status]} → ` : ""}<strong>{ORDER_STATUS[h.to_status]}</strong></>} · {h.actor_name ?? "—"}{h.note && <div className="text-slate-600">{h.note}</div>}</li>
              ))}
            </ol>
          </Card>

          {returns.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">Retours</h2>
              {returns.map((r) => (
                <div key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p><Badge tone={r.status === "requested" || r.status === "accepted" ? "amber" : "slate"}>{{ requested: "Demandé", accepted: "Accepté", refused: "Refusé", completed: "Terminé" }[r.status as "requested"]}</Badge> {formatDateTime(r.requested_at)}</p>
                  <p className="mt-1">{r.reason}</p>
                  {r.decision_note && <p className="text-slate-600">Décision : {r.decision_note}</p>}
                  {r.restocked !== null && <p className="text-slate-600">{r.restocked ? "Remis en stock" : "Non remis en stock"}</p>}
                  {canManage && r.status === "requested" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <InlineAction action={decideReturnAction} fields={{ returnId: r.id, decision: "accept" }} variant="success">Accepter</InlineAction>
                      <ConfirmAction action={decideReturnAction} fields={{ returnId: r.id, decision: "refuse" }} label="Refuser" title="Refuser le retour" confirmLabel="Refuser" description="Le client est informé du motif.">
                        <Field name="note" label="Motif" required />
                      </ConfirmAction>
                    </div>
                  )}
                  {canManage && r.status === "accepted" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {can(actor.roles, "stock.manage") && (
                        <ConfirmAction action={completeReturnAction} fields={{ returnId: r.id, restock: "yes" }} label="Réceptionner et remettre en stock" variant="success"
                          title="Remettre les produits en stock ?" confirmLabel="Réceptionner" description="À choisir seulement si les produits sont intacts et revendables (emballage, péremption, conditions de conservation)." />
                      )}
                      <ConfirmAction action={completeReturnAction} fields={{ returnId: r.id, restock: "no" }} label="Réceptionner sans remise en stock" variant="secondary"
                        title="Réceptionner sans remettre en stock ?" confirmLabel="Réceptionner" description="La commande passera à « Retournée ». Le remboursement éventuel se fait par un avoir." />
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {canManage && next.length > 0 && (
            <Card className="space-y-2 p-5">
              <h2 className="font-semibold">Faire avancer la commande</h2>
              {next.map((to) => (
                <ConfirmAction key={to} action={changeOrderStatusAction} fields={{ orderId: o.id, to }}
                  label={to === "cancelled" ? "Annuler la commande" : `→ ${ORDER_STATUS[to]}`} variant={to === "cancelled" ? "danger" : "primary"}
                  title={`${o.number} : ${ORDER_STATUS[to]}`} confirmLabel="Confirmer"
                  description={HINT[to] ?? "Le client sera notifié du changement de statut."}>
                  <Field name="note" label={to === "cancelled" ? "Motif d'annulation" : "Message au client (facultatif)"} as="textarea" rows={2} required={to === "cancelled"} />
                </ConfirmAction>
              ))}
            </Card>
          )}
          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Paiement et livraison</h2>
            <p>Moyen choisi : <strong>{methodName}</strong></p>
            {shipment ? (
              <p>Livraison : <DeliveryBadge status={shipment.status} />{" "}
                {(can(actor.roles, "deliveries.manage")) && <Link href={`/admin/livraisons/${shipment.id}`} className="font-semibold text-brand-700 underline">Gérer la livraison</Link>}</p>
            ) : <p className="text-slate-600">La livraison sera créée lorsque la commande sera prête à expédier.</p>}
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Client</h2>
            <p><Link href={`/admin/clients/${o.customer_id}`} className="font-medium text-brand-700 underline">{o.business_name ?? o.customer_name}</Link> · {o.customer_type === "business" ? "Professionnel" : "Particulier"}</p>
            <p className="text-slate-600">{o.customer_phone} · {o.customer_email}</p>
            <h3 className="pt-2 font-semibold">Livraison — {o.zone_name}</h3>
            <p>{o.ship_recipient} · {o.ship_phone}</p>
            <p className="text-slate-600">{o.ship_line1}{o.ship_district ? `, ${o.ship_district}` : ""}, {o.ship_city}</p>
            {o.ship_landmark && <p className="text-slate-500">Repère : {o.ship_landmark}</p>}
            {o.customer_note && <p className="rounded bg-amber-50 p-2 text-amber-900">Instructions : {o.customer_note}</p>}
          </Card>
          <Card className="space-y-1 p-5 text-sm">
            <p className="flex justify-between"><span>Sous-total</span><span>{formatMRU(o.subtotal_minor)}</span></p>
            {o.discount_minor > 0 && <p className="flex justify-between text-leaf-700"><span>dont remises</span><span>{formatMRU(o.discount_minor)}</span></p>}
            <p className="flex justify-between"><span>Livraison</span><span>{formatMRU(o.shipping_minor)}</span></p>
            <p className="flex justify-between border-t border-slate-100 pt-1 text-base font-bold"><span>Total</span><span>{formatMRU(o.total_minor)}</span></p>
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Facturation</h2>
            {invoices.length === 0 && <p className="text-slate-600">Aucune facture.</p>}
            <ul className="space-y-1">
              {invoices.map((i) => (
                <li key={i.id}><Link href={`/admin/factures/${i.id}`} className="font-medium text-brand-700 underline">{i.kind === "credit_note" ? "Avoir" : "Facture"} {i.number ?? "(brouillon)"}</Link> · {INVOICE_STATUS[i.status as "draft"]} · {formatMRU(i.total_minor)}</li>
              ))}
            </ul>
            {canInvoice && <InlineAction action={createInvoiceFromOrderAction} fields={{ orderId: o.id }} variant="primary">Préparer la facture</InlineAction>}
            {!canInvoice && ["new", "pending_confirmation"].includes(o.status) && <p className="text-xs text-slate-500">La facture peut être préparée une fois la commande confirmée.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
