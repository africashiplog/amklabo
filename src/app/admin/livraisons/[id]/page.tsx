import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryBadge } from "@/components/delivery-badge";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { Alert, Card, LinkButton, PageHeader } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDateTime } from "@/lib/format";
import { formatMRU, minorToInput } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { DELIVERY_STATUS, getShipment, listDrivers } from "@/server/services/deliveries";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { assignShipmentAction, completeDeliveryAction, failDeliveryAction, startDeliveryAction } from "../../payment-actions";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActorPage(`/admin/livraisons/${id}`);
  // Contrôle d'accès dans le service : gestionnaire, ou livreur affecté uniquement.
  const data = await getShipment(actor, id);
  if (!data) notFound();
  const { shipment: s, items, events, amountToCollect, canManage } = data;
  const drivers = canManage ? await listDrivers(actor) : [];
  const isCod = s.payment_method_code === "cash_on_delivery";

  return (
    <>
      <Link href={canManage ? "/admin/livraisons" : "/admin/livraisons/mes"} className="text-sm text-brand-700 hover:underline">← Livraisons</Link>
      <PageHeader title={`Livraison ${s.order_number}`} description={<DeliveryBadge status={s.status} />}
        actions={<LinkButton href={`/admin/livraisons/${s.id}/fiche`} variant="secondary">Fiche de livraison</LinkButton>} />
      {s.status === "failed" && s.failed_reason && <div className="mb-4"><Alert tone="error">Dernière tentative échouée : {s.failed_reason}</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="space-y-1 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Destinataire</h2>
            <p className="text-base font-medium">{s.ship_recipient}</p>
            <p><a href={`tel:${s.ship_phone.replace(/\s/g, "")}`} className="font-semibold text-brand-700 underline">{s.ship_phone}</a></p>
            {["assigned", "in_transit", "failed"].includes(s.status) && (
              <WhatsAppButton phone={s.ship_phone} label="Prévenir le destinataire sur WhatsApp"
                message={`Bonjour ${s.ship_recipient},\nVotre commande ${s.order_number} ${s.status === "in_transit" ? "est en route" : s.status === "failed" ? "n'a pas pu être livrée : convenons d'un nouveau créneau" : "va bientôt être livrée"}.${isCod && amountToCollect > 0 ? `\nMontant à régler en espèces à la livraison : ${formatMRU(amountToCollect)}.` : ""}\nNous ne vous demanderons jamais votre code PIN ni votre mot de passe.`} />
            )}
            <p>{s.ship_line1}{s.ship_district ? `, ${s.ship_district}` : ""}, {s.ship_city} — zone {s.zone_name}</p>
            {s.ship_landmark && <p className="text-slate-600">Repère : {s.ship_landmark}</p>}
            {s.customer_note && <p className="rounded bg-amber-50 p-2 text-amber-900">Instructions : {s.customer_note}</p>}
            {s.business_name && <p className="text-slate-600">Établissement : {s.business_name}</p>}
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-2 font-semibold">Colis</h2>
            <ul className="space-y-1">
              {items.map((i, k) => <li key={k}>{i.quantity} × {i.name} <span className="text-slate-500">({t.saleUnit[i.sale_unit as "box"].toLowerCase()}{i.units_per_sale_unit > 1 ? ` de ${i.units_per_sale_unit}` : ""}) · {i.sku}</span></li>)}
            </ul>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-2 font-semibold">Historique</h2>
            <ol className="space-y-1">
              {events.map((e) => <li key={e.id}><span className="text-slate-500">{formatDateTime(e.created_at)}</span> — {DELIVERY_STATUS[e.status]} · {e.actor_name ?? "—"}{e.note && <span className="text-slate-600"> — {e.note}</span>}</li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="space-y-1 p-5 text-sm">
            <h2 className="font-semibold">Encaissement</h2>
            {isCod ? (amountToCollect > 0
              ? <p className="text-lg font-bold text-amber-800">À encaisser : {formatMRU(amountToCollect)}</p>
              : <p>Rien à encaisser (déjà réglé ou en cours de vérification).</p>)
              : <p>Paiement électronique : rien à encaisser.</p>}
            {s.driver_name && <p className="pt-2 text-slate-600">Livreur : {s.driver_name}</p>}
            {s.carrier_name && <p className="text-slate-600">Transporteur : {s.carrier_name}</p>}
            {s.tracking_number && <p className="text-slate-600">Suivi : <span className="font-mono">{s.tracking_number}</span></p>}
          </Card>

          {canManage && ["pending", "assigned", "failed"].includes(s.status) && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Affectation</h2>
              <ActionForm action={assignShipmentAction}>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field name="driverId" label="Livreur" as="select" defaultValue={s.driver_id ?? ""}>
                  <option value="">— Aucun (transporteur externe) —</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </Field>
                <Field name="carrierName" label="Transporteur externe" defaultValue={s.carrier_name ?? ""} />
                <Field name="trackingNumber" label="N° de suivi" defaultValue={s.tracking_number ?? ""} />
                <Field name="scheduledFor" label="Date prévue" type="date" defaultValue={s.scheduled_for ?? ""} />
                {drivers.length === 0 && <p className="text-xs text-slate-500">Aucun livreur : créez un compte avec le rôle « Livreur » dans Utilisateurs et rôles.</p>}
                <SubmitButton size="sm">Affecter</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            {(["assigned", "failed"].includes(s.status) || (s.status === "pending" && canManage)) && (
              <ConfirmAction action={startDeliveryAction} fields={{ shipmentId: s.id }} label="Départ en livraison" variant="primary" size="md"
                title="Démarrer la livraison ?" confirmLabel="Démarrer" description="La commande passe « En livraison » ; le client est notifié." />
            )}
            {s.status === "in_transit" && (
              <>
                <ConfirmAction action={completeDeliveryAction} fields={{ shipmentId: s.id }} label="Livraison effectuée" variant="success" size="md"
                  title="Confirmer la remise au client ?" confirmLabel="Confirmer la livraison"
                  description={isCod && amountToCollect > 0 ? "Indiquez le montant réellement encaissé. Il restera à confirmer par le comptable lors de la remise des espèces." : "La commande passe « Livrée »."}>
                  {isCod && amountToCollect > 0 && <Field name="collected" label="Montant encaissé (MRU)" inputMode="decimal" defaultValue={minorToInput(amountToCollect)} required />}
                  <Field name="note" label="Remarque" hint="(facultatif)" />
                </ConfirmAction>
                <ConfirmAction action={failDeliveryAction} fields={{ shipmentId: s.id }} label="Échec de livraison" size="md"
                  title="Signaler un échec de livraison" confirmLabel="Enregistrer l'échec" description="La livraison pourra être retentée ou réaffectée.">
                  <Field name="reason" label="Raison" required />
                </ConfirmAction>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
