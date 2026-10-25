import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { InvoiceLineForm } from "@/components/invoice-line-form";
import { Alert, Badge, Card, LinkButton, PageHeader, Table, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatMRU, minorToInput } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { adminGetInvoice, INVOICE_STATUS, paymentState, PAYMENT_LABEL } from "@/server/services/invoices";
import { PaymentPanel } from "@/components/payment-panel";
import { listPaymentsFor, type PaymentMethod } from "@/server/services/payments";
import { query } from "@/server/db";
import {
  addInvoiceLineAction, cancelInvoiceAction, createCreditNoteAction, deleteDraftAction, issueInvoiceAction, updateDraftAction,
} from "../../order-actions";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("invoices.read");
  const data = await adminGetInvoice(actor, id);
  if (!data) notFound();
  const { invoice: i, items, creditNotes } = data;
  const canManage = can(actor.roles, "invoices.manage");
  const draft = i.status === "draft";
  const isCredit = i.kind === "credit_note";
  const label = isCredit ? "Avoir" : "Facture";
  const balance = Math.max(i.total_minor - i.credited_total_minor - i.amount_paid_minor, 0);
  // Règlements directs : factures manuelles seulement (ceux d'une commande se gèrent sur la commande).
  const manualPayments = !isCredit && !i.order_id && i.status === "issued" && can(actor.roles, "payments.view");
  const [payments, methods] = manualPayments
    ? await Promise.all([listPaymentsFor(actor, { invoiceId: i.id }), query<PaymentMethod>("SELECT * FROM payment_methods ORDER BY sort_order")])
    : [[], []];
  const pendingSum = payments.filter((p) => p.status === "pending_verification").reduce((a, p) => a + p.amount_minor, 0);

  return (
    <>
      <Link href="/admin/factures" className="text-sm text-brand-700 hover:underline">← Factures</Link>
      <PageHeader title={`${label} ${i.number ?? "— brouillon"}`}
        description={<>
          <Badge tone={draft ? "slate" : i.status === "issued" ? "blue" : "red"}>{INVOICE_STATUS[i.status]}</Badge>
          {i.order_number && <> · commande <Link className="underline" href={`/admin/commandes/${i.order_id}`}>{i.order_number}</Link></>}
          {isCredit && i.credited_invoice_id && <> · sur la facture <Link className="underline" href={`/admin/factures/${i.credited_invoice_id}`}>{i.credited_number}</Link></>}
          {" "}· créé par {i.created_by_name ?? "—"} le {formatDateTime(i.created_at)}
          {i.issued_at && <> · émis par {i.issued_by_name ?? "—"} le {formatDateTime(i.issued_at)}</>}
        </>}
        actions={<LinkButton href={`/factures/${i.id}/pdf`} variant="secondary" target="_blank">{draft ? "Aperçu PDF" : "Télécharger / imprimer (PDF)"}</LinkButton>} />
      {i.status === "cancelled" && <div className="mb-4"><Alert tone="error">Annulée le {formatDateTime(i.cancelled_at!)} par {i.cancelled_by_name ?? "—"} — motif : {i.cancel_reason}</Alert></div>}
      {draft && <div className="mb-4"><Alert tone="info">Brouillon sans valeur comptable : le numéro définitif est attribué à l&apos;émission. Les coordonnées du magasin seront alors figées.</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Table>
            <thead><tr><th className={th}>Désignation</th><th className={th}>Unité</th><th className={th}>Qté</th><th className={th}>P.U.</th><th className={th}>Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className={td}>{it.description}{it.sku && <div className="font-mono text-xs text-slate-400">{it.sku}</div>}</td>
                  <td className={td}>{it.unit_label}</td>
                  <td className={td}>{draft && canManage ? <InvoiceLineForm lineId={it.id} quantity={it.quantity} /> : it.quantity}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatMRU(it.unit_price_minor)}</td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{formatMRU(it.line_total_minor)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td className={td} colSpan={5}>Aucune ligne.</td></tr>}
            </tbody>
          </Table>
          {draft && canManage && !isCredit && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Ajouter une ligne</h2>
              <ActionForm action={addInvoiceLineAction} resetOnSuccess>
                <input type="hidden" name="invoiceId" value={i.id} />
                <Field name="description" label="Désignation" required />
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field name="sku" label="Référence" />
                  <Field name="unitLabel" label="Unité" defaultValue="pièce" />
                  <Field name="quantity" label="Quantité" type="number" min={1} defaultValue={1} />
                  <Field name="unitPrice" label="Prix unitaire (MRU)" inputMode="decimal" required />
                </div>
                <SubmitButton size="sm" variant="secondary">Ajouter</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {isCredit && draft && <p className="text-sm text-slate-600">Avoir partiel : réduisez les quantités ou supprimez les lignes non concernées (0). Le total ne peut pas dépasser le montant restant de la facture.</p>}
          {manualPayments && (
            <PaymentPanel target={{ invoiceId: i.id }} payments={payments} methods={methods} dueMinor={Math.max(balance - pendingSum, 0)}
              canVerify={can(actor.roles, "payments.verify")} canRefund={can(actor.roles, "payments.refund")} />
          )}
          {creditNotes.length > 0 && (
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-semibold">Avoirs liés</h2>
              <ul>{creditNotes.map((c) => <li key={c.id}><Link href={`/admin/factures/${c.id}`} className="text-brand-700 underline">{c.number ?? "Brouillon"}</Link> · {INVOICE_STATUS[c.status as "draft"]} · {formatMRU(c.total_minor)}</li>)}</ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="space-y-1 p-5 text-sm">
            <p className="flex justify-between"><span>Sous-total</span><span>{formatMRU(i.subtotal_minor)}</span></p>
            {i.discount_minor > 0 && <p className="flex justify-between text-leaf-700"><span>dont remises</span><span>{formatMRU(i.discount_minor)}</span></p>}
            {!isCredit && <p className="flex justify-between"><span>Livraison</span><span>{formatMRU(i.shipping_minor)}</span></p>}
            <p className="flex justify-between border-t border-slate-100 pt-1 text-base font-bold"><span>Total</span><span>{formatMRU(i.total_minor)}</span></p>
            {i.tax_rate_bp > 0 && <p className="flex justify-between text-slate-600"><span>dont taxe {minorToInput(i.tax_rate_bp)} %</span><span>{formatMRU(i.tax_included_minor)}</span></p>}
            {!isCredit && i.status === "issued" && (
              <>
                {i.credited_total_minor > 0 && <p className="flex justify-between"><span>Avoirs</span><span>−{formatMRU(i.credited_total_minor)}</span></p>}
                <p className="flex justify-between"><span>Réglé</span><span>{formatMRU(i.amount_paid_minor)}</span></p>
                <p className="flex justify-between font-semibold"><span>Reste à payer</span><span>{formatMRU(balance)}</span></p>
                <p className="pt-1"><Badge tone={paymentState(i) === "paid" ? "green" : "amber"}>{PAYMENT_LABEL[paymentState(i)]}</Badge></p>
                {i.order_id && <p className="text-xs text-slate-500">Les règlements se gèrent sur la <Link className="underline" href={`/admin/commandes/${i.order_id}`}>commande</Link> et sont reportés ici automatiquement.</p>}
              </>
            )}
          </Card>

          <Card className="space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Client facturé</h2>
            {draft && canManage ? (
              <ActionForm action={updateDraftAction}>
                <input type="hidden" name="invoiceId" value={i.id} />
                <Field name="buyerName" label="Nom" defaultValue={i.buyer_name} required />
                <Field name="buyerBusiness" label="Établissement" defaultValue={i.buyer_business ?? ""} />
                <Field name="buyerAddress" label="Adresse" defaultValue={i.buyer_address ?? ""} />
                <Field name="buyerProfessionalId" label="Identifiant professionnel" defaultValue={i.buyer_professional_id ?? ""} />
                {!isCredit && <Field name="shipping" label="Frais de livraison (MRU)" inputMode="decimal" defaultValue={minorToInput(i.shipping_minor)} />}
                <Field name="notes" label="Mention particulière" as="textarea" rows={2} defaultValue={i.notes ?? ""} />
                <SubmitButton size="sm" variant="secondary">Enregistrer</SubmitButton>
              </ActionForm>
            ) : (
              <div>
                <p className="font-medium">{i.buyer_business ?? i.buyer_name}</p>
                {i.buyer_business && <p>{i.buyer_name}</p>}
                <p className="text-slate-600">{i.buyer_address}</p>
                {i.buyer_professional_id && <p className="text-slate-600">Id. pro : {i.buyer_professional_id}</p>}
                {i.notes && <p className="mt-2 text-slate-600">{i.notes}</p>}
              </div>
            )}
          </Card>

          {canManage && (
            <div className="flex flex-col gap-2">
              {draft && (
                <ConfirmAction action={issueInvoiceAction} fields={{ invoiceId: i.id }} label={`Émettre ${isCredit ? "l'avoir" : "la facture"}`} variant="primary" size="md"
                  title={`Émettre ${isCredit ? "cet avoir" : "cette facture"} ?`} confirmLabel="Émettre"
                  description={<>Un numéro définitif sera attribué ({formatMRU(i.total_minor)}). Le document ne pourra plus être modifié ni supprimé : seule une annulation motivée ou un avoir sera possible.</>} />
              )}
              {draft && can(actor.roles, "invoices.delete") && (
                <ConfirmAction action={deleteDraftAction} fields={{ invoiceId: i.id }} label="Supprimer le brouillon" size="md"
                  title="Supprimer ce brouillon ?" confirmLabel="Supprimer" description="Le brouillon n'a pas de numéro : sa suppression n'affecte pas la numérotation." />
              )}
              {!isCredit && i.status === "issued" && i.credited_total_minor < i.total_minor && (
                <ConfirmAction action={createCreditNoteAction} fields={{ invoiceId: i.id }} label="Établir un avoir" variant="secondary" size="md"
                  title="Établir un avoir ?" confirmLabel="Créer le brouillon d'avoir" description="Un avoir en brouillon reprend les lignes de la facture ; ajustez-le avant de l'émettre." />
              )}
              {i.status === "issued" && !isCredit && (
                <ConfirmAction action={cancelInvoiceAction} fields={{ invoiceId: i.id }} label="Annuler la facture" size="md"
                  title={`Annuler la facture ${i.number} ?`} confirmLabel="Annuler la facture"
                  description="La facture reste conservée avec la mention « Annulée », le motif, votre nom et la date. Son numéro n'est jamais réutilisé. Impossible si un règlement ou un avoir est enregistré.">
                  <Field name="reason" label="Motif" as="textarea" rows={2} required />
                </ConfirmAction>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
