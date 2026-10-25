import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction, Field, InlineAction } from "@/components/forms";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-badges";
import { Alert, Badge, Card, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { ORDER_STATUS, getMyOrder } from "@/server/services/orders";
import { DELIVERY_STATUS, getShipmentForOrder } from "@/server/services/deliveries";
import { listActiveMethods, listMyOrderPayments, orderAmountDue, PAYMENT_RECORD_STATUS } from "@/server/services/payments";
import { PaymentForm } from "@/components/payment-form";
import { cancelMyOrderAction, reorderAction, requestReturnAction } from "../../../../actions/shop";

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ confirmee?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Commande ${(await params).number}` };
}

const RETURN_LABEL = { requested: "Demandé", accepted: "Accepté — en attente de réception", refused: "Refusé", completed: "Terminé" } as const;

export default async function MyOrder({ params, searchParams }: Props) {
  const { number } = await params;
  const actor = await requireActorPage(`/compte/commandes/${number}`);
  const data = await getMyOrder(actor, number).catch(() => null);
  if (!data) notFound();
  const { order: o, items, history, returns, invoices } = data;
  const { confirmee } = await searchParams;
  const canCancel = ["new", "pending_confirmation", "confirmed", "preparing"].includes(o.status) && !o.cancel_requested_at;
  const direct = ["new", "pending_confirmation"].includes(o.status);
  const [payments, shipment, methods, due] = await Promise.all([
    listMyOrderPayments(actor, number), getShipmentForOrder(o.id), listActiveMethods(), orderAmountDue(undefined, o.id),
  ]);
  const method = methods.find((m) => m.code === o.payment_method_code) ?? null;
  const canPay = method?.kind === "mobile_money" && due > 0 && !["cancelled", "returned"].includes(o.status);
  const canReturn = o.status === "delivered" && !returns.some((r) => r.status === "requested" || r.status === "accepted");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/compte/commandes" className="text-sm text-brand-700 hover:underline">← Mes commandes</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Commande {o.number}</h1>
        <OrderStatusBadge status={o.status} />
        <PaymentStatusBadge status={o.payment_status} />
      </div>
      <p className="mt-1 text-sm text-slate-600">Passée le {formatDateTime(o.placed_at)}</p>
      {confirmee && <div className="mt-4"><Alert tone="success">Merci ! Votre commande a bien été enregistrée. Notre équipe va la confirmer.{canPay ? " Vous pouvez dès maintenant effectuer le paiement et transmettre sa référence ci-dessous." : ""}</Alert></div>}
      {o.cancel_requested_at && <div className="mt-4"><Alert tone="warning">Demande d&apos;annulation envoyée le {formatDateTime(o.cancel_requested_at)} — en attente de réponse.</Alert></div>}
      {o.status === "cancelled" && o.cancel_reason && <div className="mt-4"><Alert tone="error">Commande annulée : {o.cancel_reason}</Alert></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <Table>
            <thead><tr><th className={th}>Produit</th><th className={th}>Qté</th><th className={th}>Prix unitaire</th><th className={th}>Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className={td}><Link href={`/produits/${i.slug}`} className="font-medium hover:text-brand-700">{i.name}</Link>
                    <div className="text-xs text-slate-500">Réf. {i.sku} · {t.saleUnit[i.sale_unit as "box"].toLowerCase()}{i.units_per_sale_unit > 1 ? ` de ${i.units_per_sale_unit}` : ""}</div></td>
                  <td className={td}>{i.quantity}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatMRU(i.unit_price_minor)}{i.unit_price_minor < i.retail_unit_price_minor && <div className="text-xs text-leaf-700">{i.price_label}</div>}</td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(i.line_total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Suivi</h2>
            <ol className="space-y-3 border-s-2 border-brand-100 ps-4">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="font-medium">{h.from_status === h.to_status ? "Information" : ORDER_STATUS[h.to_status]} <span className="font-normal text-slate-500">· {formatDateTime(h.created_at)}</span></p>
                  {h.note && <p className="text-slate-600">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>

          {returns.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Retours</h2>
              {returns.map((r) => (
                <div key={r.id} className="text-sm"><Badge>{RETURN_LABEL[r.status as keyof typeof RETURN_LABEL]}</Badge> {r.reason}{r.decision_note && <p className="text-slate-600">Réponse : {r.decision_note}</p>}</div>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="space-y-2 p-5 text-sm">
            <p className="flex justify-between"><span>Sous-total</span><span>{formatMRU(o.subtotal_minor)}</span></p>
            {o.discount_minor > 0 && <p className="flex justify-between text-leaf-700"><span>dont remises</span><span>{formatMRU(o.discount_minor)}</span></p>}
            <p className="flex justify-between"><span>Livraison ({o.zone_name})</span><span>{formatMRU(o.shipping_minor)}</span></p>
            <p className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold"><span>Total</span><span>{formatMRU(o.total_minor)}</span></p>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-2 font-semibold">Livraison</h2>
            <p>{o.ship_recipient} · {o.ship_phone}</p>
            <p className="text-slate-600">{o.ship_line1}{o.ship_district ? `, ${o.ship_district}` : ""}, {o.ship_city}</p>
            {o.ship_landmark && <p className="text-slate-500">Repère : {o.ship_landmark}</p>}
            {o.customer_note && <p className="mt-2 text-slate-600">Instructions : {o.customer_note}</p>}
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Paiement</h2>
            <p>{method?.name ?? "—"}</p>
            {canPay && method && (
              <div className="space-y-2 rounded-lg bg-brand-50 p-3 text-brand-900">
                <p>Montant à régler : <strong>{formatMRU(due)}</strong></p>
                <p>Compte marchand {method.name} : <strong className="font-mono">{method.merchant_account}</strong></p>
                {method.instructions && <p className="whitespace-pre-line text-xs">{method.instructions}</p>}
                <p className="text-xs">Indiquez votre numéro de commande <strong>{o.number}</strong> dans le motif si possible.</p>
                <PaymentForm number={o.number} referenceLabel={method.reference_label} allowsProof={method.allows_proof} />
              </div>
            )}
            {payments.some((p) => p.status === "pending_verification") && (
              <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Votre paiement a bien été transmis : il est en cours de vérification par notre équipe. Vous serez notifié du résultat.</p>
            )}
            {method?.kind === "cash_on_delivery" && due > 0 && <p className="text-slate-600">À régler en espèces à la livraison : {formatMRU(due)}.</p>}
            {payments.length > 0 && (
              <ul className="space-y-1 border-t border-slate-100 pt-2">
                {payments.map((p) => (
                  <li key={p.id}>
                    {p.kind === "refund" ? "Remboursement" : p.method_name} · {formatMRU(p.amount_minor)} · <Badge tone={p.status === "confirmed" ? "green" : p.status === "refused" ? "red" : "amber"}>{PAYMENT_RECORD_STATUS[p.status]}</Badge>
                    {p.transaction_reference && <span className="block font-mono text-xs text-slate-500">Réf. {p.transaction_reference}</span>}
                    {p.decision_note && <span className="block text-xs text-red-700">{p.decision_note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {shipment && (
            <Card className="space-y-1 p-5 text-sm">
              <h2 className="font-semibold">Livraison</h2>
              <p><Badge tone={shipment.status === "delivered" ? "green" : shipment.status === "failed" ? "red" : "blue"}>{DELIVERY_STATUS[shipment.status]}</Badge></p>
              {shipment.scheduled_for && <p>Prévue le {shipment.scheduled_for.split("-").reverse().join("/")}</p>}
              {shipment.carrier_name && <p>Transporteur : {shipment.carrier_name}</p>}
              {shipment.tracking_number && <p>N° de suivi : <span className="font-mono">{shipment.tracking_number}</span></p>}
              {shipment.status === "failed" && shipment.failed_reason && <p className="text-red-700">Tentative échouée : {shipment.failed_reason}. Nous vous recontacterons.</p>}
            </Card>
          )}
          {invoices.length > 0 && (
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-semibold">Factures</h2>
              <ul className="space-y-1">
                {invoices.map((i) => (
                  <li key={i.id}><a href={`/factures/${i.id}/pdf`} target="_blank" className="font-medium text-brand-700 underline">{i.kind === "credit_note" ? "Avoir" : "Facture"} {i.number}</a>{i.status === "cancelled" && <span className="ms-1 text-xs text-red-700">(annulée)</span>} · {formatMRU(i.total_minor)}</li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex flex-col gap-2">
            <InlineAction action={reorderAction} fields={{ number: o.number }}>Commander à nouveau</InlineAction>
            {canCancel && (
              <ConfirmAction action={cancelMyOrderAction} fields={{ number: o.number }} label={direct ? "Annuler la commande" : "Demander l'annulation"}
                title={direct ? `Annuler la commande ${o.number} ?` : `Demander l'annulation de ${o.number} ?`}
                confirmLabel={direct ? "Annuler la commande" : "Envoyer la demande"}
                description={direct ? "La commande sera annulée immédiatement." : "Votre commande est déjà confirmée : notre équipe examinera votre demande."}>
                <Field name="reason" label="Motif" required />
              </ConfirmAction>
            )}
            {canReturn && (
              <ConfirmAction action={requestReturnAction} fields={{ number: o.number }} label="Demander un retour" variant="secondary"
                title="Demander un retour" confirmLabel="Envoyer la demande"
                description={<>Les conditions de retour sont décrites dans notre <Link href="/livraison-retours" className="underline">politique de livraison et de retour</Link>.</>}>
                <Field name="reason" label="Motif du retour" as="textarea" rows={3} required />
              </ConfirmAction>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
