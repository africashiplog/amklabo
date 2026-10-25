"use client";

import { useActionState } from "react";
import { setInvoiceLineAction } from "@/app/admin/order-actions";
import { Button } from "./ui";

export function InvoiceLineForm({ lineId, quantity }: { lineId: string; quantity: number }) {
  const [state, action, pending] = useActionState(setInvoiceLineAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="lineId" value={lineId} />
      <input name="quantity" type="number" min={1} defaultValue={quantity} aria-label="Quantité" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
      <Button size="sm" variant="secondary" disabled={pending}>OK</Button>
      <Button size="sm" variant="ghost" name="remove" value="1" disabled={pending} className="text-red-700" aria-label="Supprimer la ligne">✕</Button>
      {state.ok === false && <span role="alert" className="text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
