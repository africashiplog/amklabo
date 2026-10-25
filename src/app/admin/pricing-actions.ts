"use server";

import { revalidatePath } from "next/cache";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import {
  addTier, deleteCustomerPrice, deletePromotion, deleteTier, savePromotion, setCustomerPrice,
} from "@/server/services/pricing";

const refresh = () => revalidatePath("/", "layout");

export async function addTierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addTier(await getActor(), formString(fd, "productId"), {
      audience: formString(fd, "audience") === "all" ? "all" : "business",
      minQty: formString(fd, "minQty"), unitPrice: formString(fd, "unitPrice"),
      validFrom: formString(fd, "validFrom"), validTo: formString(fd, "validTo"),
    });
    refresh();
    return "Palier ajouté.";
  });
}

export async function deleteTierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteTier(await getActor(), formString(fd, "tierId"));
    refresh();
    return "Palier supprimé.";
  });
}

export async function setCustomerPriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setCustomerPrice(await getActor(), formString(fd, "customerId"), {
      productId: formString(fd, "productId"), minQty: formString(fd, "minQty") || "1", unitPrice: formString(fd, "unitPrice"),
      validFrom: formString(fd, "validFrom"), validTo: formString(fd, "validTo"), note: formString(fd, "note"),
    });
    refresh();
    return "Prix négocié enregistré.";
  });
}

export async function deleteCustomerPriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteCustomerPrice(await getActor(), formString(fd, "id"));
    refresh();
    return "Prix négocié supprimé.";
  });
}

export async function savePromotionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await savePromotion(await getActor(), formOptional(fd, "id"), {
      name: formString(fd, "name"),
      target: formString(fd, "target") === "category" ? "category" : "product",
      productId: formOptional(fd, "productId"), categoryId: formOptional(fd, "categoryId"),
      audience: (["all", "retail", "business"].includes(formString(fd, "audience")) ? formString(fd, "audience") : "all") as "all",
      discountType: formString(fd, "discountType") === "amount" ? "amount" : "percent",
      discountValue: formString(fd, "discountValue"),
      startsAt: formString(fd, "startsAt"), endsAt: formString(fd, "endsAt"), isActive: fd.get("isActive") === "on",
    });
    refresh();
    return "Promotion enregistrée.";
  });
}

export async function deletePromotionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deletePromotion(await getActor(), formString(fd, "id"));
    refresh();
    return "Promotion supprimée.";
  });
}
