import Link from "next/link";
import { ConfirmAction, Field } from "./forms";
import { Badge, Card } from "./ui";
import { formatDateTime } from "@/lib/format";
import { formatMRU, minorToInput } from "@/lib/money";
import type { PaymentMethod, PaymentRow } from "@/server/services/payments";
import { PAYMENT_RECORD_STATUS } from "@/server/services/payments";
import { recordPaymentAction, recordRefundAction, verifyPaymentAction } from "@/app/admin/payment-actions";

const tone = { pending_verification: "amber", confirmed: "green", refused: "red", failed: "red" } as const;

/** Ligne de paiement avec, pour un vérificateur, les boutons confirmer / refuser. */
export function PaymentItem({ p, canVerify, showTarget = false }: { p: PaymentRow; canVerify: boolean; showTarget?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {p.kind === "refund" ? "Remboursement" : p.method_name} · {formatMRU(p.amount_minor)} <Badge tone={tone[p.status]}>{PAYMENT_RECORD_STATUS[p.status]}</Badge>
          </p>
          {showTarget && (
            <p className="text-slate-600">
              {p.order_id ? <Link href={`/admin/commandes/${p.order_id}`} className="font-mono underline">{p.order_number}</Link>
                : <Link href={`/admin/factures/${p.invoice_id}`} className="font-mono underline">{p.invoice_number}</Link>} · {p.customer_name}
              {p.due_total_minor != null && <> · total {formatMRU(p.due_total_minor)}</>}
            </p>
          )}
          {p.transaction_reference && <p className="font-mono text-xs">Réf. {p.transaction_reference}</p>}
          {p.payer_phone && <p className="text-xs text-slate-500">Payé depuis le {p.payer_phone}</p>}
          {p.note && <p className="text-xs text-slate-600">{p.note}</p>}
          <p className="text-xs text-slate-500">Transmis le {formatDateTime(p.submitted_at)} par {p.submitter_name ?? "—"}</p>
          {p.verified_at && <p className="text-xs text-slate-500">Traité le {formatDateTime(p.verified_at)} par {p.verifier_name ?? "—"}{p.decision_note ? ` — ${p.decision_note}` : ""}</p>}
          {p.has_proof && <a href={`/paiements/${p.id}/justificatif`} target="_blank" className="text-xs font-semibold text-brand-700 underline">Voir le justificatif</a>}
        </div>
        {canVerify && p.status === "pending_verification" && (
          <div className="flex flex-wrap gap-2">
            <ConfirmAction action={verifyPaymentAction} fields={{ paymentId: p.id, decision: "confirm" }} label="Confirmer" variant="success"
              title="Confirmer ce paiement ?" confirmLabel="Confirmer le paiement"
              description={<>Confirmez uniquement après avoir constaté la réception des fonds{p.method_code === "cash_on_delivery" ? " (espèces remises en caisse)" : " sur le compte marchand officiel"}. Un justificatif seul ne suffit pas. Votre nom et la date seront enregistrés.</>}>
              <Field name="amount" label="Montant effectivement reçu (MRU)" inputMode="decimal" defaultValue={minorToInput(p.amount_minor)} required />
              <Field name="note" label="Note" hint="(facultatif)" />
            </ConfirmAction>
            <ConfirmAction action={verifyPaymentAction} fields={{ paymentId: p.id, decision: "refuse" }} label="Refuser"
              title="Refuser ce paiement ?" confirmLabel="Refuser" description="Le client est informé du motif et peut transmettre une nouvelle référence.">
              <Field name="note" label="Motif (communiqué au client)" required />
            </ConfirmAction>
          </div>
        )}
      </div>
    </div>
  );
}

/** Panneau paiements d'une commande ou d'une facture manuelle. */
export function PaymentPanel({ target, payments, methods, dueMinor, canVerify, canRefund }: {
  target: { orderId?: string; invoiceId?: string }; payments: PaymentRow[]; methods: PaymentMethod[];
  dueMinor: number; canVerify: boolean; canRefund: boolean;
}) {
  const fields: Record<string, string> = target.orderId ? { orderId: target.orderId } : { invoiceId: target.invoiceId! };
  const methodSelect = (
    <Field name="methodCode" label="Moyen de paiement" as="select" required>
      {methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
    </Field>
  );
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">Paiements</h2>
      <p className="text-sm">Reste à régler (hors paiements en attente) : <strong>{formatMRU(dueMinor)}</strong></p>
      {payments.length === 0 && <p className="text-sm text-slate-600">Aucun paiement.</p>}
      {payments.map((p) => <PaymentItem key={p.id} p={p} canVerify={canVerify} />)}
      <div className="flex flex-wrap gap-2">
        {canVerify && dueMinor > 0 && (
          <ConfirmAction action={recordPaymentAction} fields={fields} label="Enregistrer un règlement" variant="secondary"
            title="Enregistrer un règlement constaté" confirmLabel="Enregistrer"
            description="À utiliser pour un règlement déjà vérifié (espèces reçues en caisse, transaction contrôlée sur le compte marchand). Il est confirmé en votre nom.">
            {methodSelect}
            <Field name="amount" label="Montant (MRU)" inputMode="decimal" defaultValue={minorToInput(dueMinor)} required />
            <Field name="reference" label="Référence de transaction" hint="(obligatoire pour un paiement électronique)" />
            <Field name="note" label="Note" />
          </ConfirmAction>
        )}
        {canRefund && payments.some((p) => p.kind === "payment" && p.status === "confirmed") && (
          <ConfirmAction action={recordRefundAction} fields={fields} label="Enregistrer un remboursement" variant="secondary"
            title="Enregistrer un remboursement" confirmLabel="Enregistrer le remboursement"
            description="Enregistrez le remboursement une fois effectué. Pensez à établir l'avoir correspondant.">
            {methodSelect}
            <Field name="amount" label="Montant remboursé (MRU)" inputMode="decimal" required />
            <Field name="reference" label="Référence" />
            <Field name="note" label="Motif" required />
          </ConfirmAction>
        )}
      </div>
    </Card>
  );
}
