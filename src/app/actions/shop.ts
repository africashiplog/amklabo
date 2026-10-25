"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import { UserError } from "@/server/errors";
import { markAllRead } from "@/server/services/notifications";
import { addToCart, cancelMyOrder, placeOrder, reorder, requestReturn, setCartQuantity } from "@/server/services/orders";

const int = (v: string) => (/^\d{1,7}$/.test(v.trim()) ? Number(v) : NaN);

export async function addToCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await getActor();
    if (!actor) redirect(`/connexion?next=${encodeURIComponent(formString(fd, "back") || "/panier")}`);
    await addToCart(actor, formString(fd, "productId"), int(formString(fd, "quantity")));
    revalidatePath("/", "layout");
    return "Ajouté au panier.";
  });
}

export async function updateCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const q = fd.get("remove") ? 0 : int(formString(fd, "quantity"));
    await setCartQuantity(await getActor(), formString(fd, "productId"), q);
    revalidatePath("/", "layout");
    return q === 0 ? "Produit retiré." : "Quantité mise à jour.";
  });
}

export async function placeOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let number = "";
  const state = await runAction(async () => {
    const addressId = formString(fd, "addressId");
    if (!addressId) throw new UserError("Choisissez une adresse de livraison.", { addressId: "Adresse requise" });
    const expected = Number(formString(fd, `expected_${addressId}`));
    const res = await placeOrder(await getActor(), {
      addressId, note: formString(fd, "note"), idempotencyKey: formString(fd, "idempotencyKey"),
      expectedTotalMinor: Number.isFinite(expected) ? expected : null,
    });
    number = res.number;
    revalidatePath("/", "layout");
  });
  if (state.ok) redirect(`/compte/commandes/${number}?confirmee=1`);
  return state;
}

export async function cancelMyOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const res = await cancelMyOrder(await getActor(), formString(fd, "number"), formString(fd, "reason"));
    revalidatePath("/compte/commandes");
    return res === "cancelled" ? "Commande annulée." : "Demande d'annulation envoyée à notre équipe.";
  });
}

export async function requestReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requestReturn(await getActor(), formString(fd, "number"), formString(fd, "reason"));
    revalidatePath("/compte/commandes");
    return "Demande de retour envoyée.";
  });
}

export async function reorderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const state = await runAction(async () => {
    const r = await reorder(await getActor(), formString(fd, "number"));
    if (r.added === 0) throw new UserError("Aucun produit de cette commande n'est disponible actuellement.");
    ok = true;
    revalidatePath("/", "layout");
  });
  if (ok) redirect("/panier?recommande=1");
  return state;
}

export async function markNotificationsReadAction(): Promise<void> {
  await markAllRead(await getActor());
  revalidatePath("/", "layout");
}
