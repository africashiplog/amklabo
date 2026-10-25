"use client";

import { submitPaymentAction } from "@/app/actions/shop";
import { ActionForm, Field, SubmitButton } from "./forms";

export function PaymentForm({ number, referenceLabel, allowsProof }: { number: string; referenceLabel: string; allowsProof: boolean }) {
  return (
    <ActionForm action={submitPaymentAction} resetOnSuccess>
      <input type="hidden" name="number" value={number} />
      <Field name="reference" label={referenceLabel} required autoComplete="off" />
      <Field name="payerPhone" label="Numéro utilisé pour payer" hint="(facultatif)" type="tel" />
      {allowsProof && <Field name="proof" label="Justificatif" hint="(capture PNG ou JPEG, facultatif)" type="file" accept="image/png,image/jpeg" />}
      <p className="text-xs">Le paiement reste « en attente de vérification » jusqu&apos;à son contrôle par notre équipe.</p>
      <SubmitButton size="sm" pendingLabel="Envoi…">Transmettre le paiement</SubmitButton>
    </ActionForm>
  );
}
