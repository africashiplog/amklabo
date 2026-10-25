"use client";

import { useActionState } from "react";
import Link from "next/link";
import { addToCartAction } from "@/app/actions/shop";
import { Alert, Button, Input } from "./ui";

export function AddToCart({ productId, minQty, defaultQty, back }: { productId: string; minQty: number; defaultQty: number; back: string }) {
  const [state, action, pending] = useActionState(addToCartAction, {});
  return (
    <form action={action} className="mt-4 space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="cart-qty" className="mb-1 block text-xs font-medium text-slate-600">Quantité</label>
          <Input id="cart-qty" name="quantity" type="number" min={minQty} max={100000} defaultValue={defaultQty} className="w-28" />
        </div>
        <Button type="submit" variant="success" disabled={pending}>{pending ? "Ajout…" : "Ajouter au panier"}</Button>
      </div>
      {state.message && (
        <Alert tone={state.ok ? "success" : "error"}>
          {state.message} {state.ok && <Link href="/panier" className="font-semibold underline">Voir le panier</Link>}
        </Alert>
      )}
    </form>
  );
}
