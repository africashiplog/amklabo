"use client";

import { useActionState } from "react";
import { updateCartAction } from "@/app/actions/shop";
import { Button } from "./ui";

export function CartLineForm({ productId, quantity, min, name }: { productId: string; quantity: number; min: number; name: string }) {
  const [state, action, pending] = useActionState(updateCartAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <label className="sr-only" htmlFor={`q-${productId}`}>Quantité — {name}</label>
      <input id={`q-${productId}`} name="quantity" type="number" min={min} max={100000} defaultValue={quantity}
        className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Mettre à jour</Button>
      <Button type="submit" name="remove" value="1" size="sm" variant="ghost" disabled={pending} className="text-red-700">Retirer</Button>
      {state.ok === false && <span role="alert" className="text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
