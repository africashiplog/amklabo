"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import {
  addPoItem, cancelPurchaseOrder, createPurchaseOrder, linkProductSupplier, markPoOrdered, receivePurchaseOrder,
  removePoItem, saveSupplier, unlinkProductSupplier,
} from "@/server/services/purchasing";
import { recordCount, recordEntry, recordExit } from "@/server/services/stock";

const refresh = () => revalidatePath("/", "layout");

export async function stockEntryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await recordEntry(await getActor(), {
      productId: formString(fd, "productId"), type: formString(fd, "type") === "return_in" ? "return_in" : "manual_in",
      quantity: formString(fd, "quantity"), lotNumber: formString(fd, "lotNumber"), expiryDate: formString(fd, "expiryDate"),
      supplierId: formOptional(fd, "supplierId"), unitCost: formString(fd, "unitCost"), reason: formString(fd, "reason"),
    });
    refresh();
    return "Entrée de stock enregistrée.";
  });
}

export async function stockExitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await recordExit(await getActor(), {
      productId: formString(fd, "productId"), lotId: formOptional(fd, "lotId"),
      type: formString(fd, "type") as "loss", quantity: formString(fd, "quantity"), reason: formString(fd, "reason"),
    });
    refresh();
    return "Sortie de stock enregistrée.";
  });
}

export async function stockCountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await recordCount(await getActor(), { lotId: formString(fd, "lotId"), counted: formString(fd, "counted"), reason: formString(fd, "reason") });
    refresh();
    return "Inventaire enregistré.";
  });
}

export async function saveSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = formOptional(fd, "id");
  let newId = "";
  const state = await runAction(async () => {
    newId = await saveSupplier(await getActor(), id, {
      name: formString(fd, "name"), contactName: formString(fd, "contactName"), phone: formString(fd, "phone"),
      email: formString(fd, "email"), address: formString(fd, "address"), country: formString(fd, "country"),
      notes: formString(fd, "notes"), isActive: fd.get("isActive") === "on",
    });
    revalidatePath("/admin/fournisseurs");
    return "Fournisseur enregistré.";
  });
  if (state.ok && !id) redirect(`/admin/fournisseurs/${newId}`);
  return state;
}

export async function linkProductSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await linkProductSupplier(await getActor(), formString(fd, "supplierId"), formString(fd, "productId"), formOptional(fd, "supplierSku"));
    revalidatePath("/admin/fournisseurs");
    return "Produit associé.";
  });
}

export async function unlinkProductSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await unlinkProductSupplier(await getActor(), formString(fd, "supplierId"), formString(fd, "productId"));
    revalidatePath("/admin/fournisseurs");
    return "Association retirée.";
  });
}

export async function createPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    id = (await createPurchaseOrder(await getActor(), {
      supplierId: formString(fd, "supplierId"), expectedAt: formString(fd, "expectedAt"), notes: formString(fd, "notes"),
    })).id;
  });
  if (state.ok) redirect(`/admin/achats/${id}`);
  return state;
}

export async function addPoItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addPoItem(await getActor(), formString(fd, "poId"), {
      productId: formString(fd, "productId"), quantity: formString(fd, "quantity"), unitCost: formString(fd, "unitCost"),
    });
    revalidatePath("/admin/achats");
    return "Ligne enregistrée.";
  });
}

export async function removePoItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await removePoItem(await getActor(), formString(fd, "itemId"));
    revalidatePath("/admin/achats");
    return "Ligne retirée.";
  });
}

export async function markPoOrderedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await markPoOrdered(await getActor(), formString(fd, "poId"));
    revalidatePath("/admin/achats");
    return "Bon d'achat validé comme commandé.";
  });
}

export async function cancelPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cancelPurchaseOrder(await getActor(), formString(fd, "poId"), formString(fd, "reason"));
    revalidatePath("/admin/achats");
    return "Bon d'achat annulé.";
  });
}

export async function receivePoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ids = fd.getAll("itemId").map(String);
    const qty = fd.getAll("quantity").map(String);
    const lots = fd.getAll("lotNumber").map(String);
    const exp = fd.getAll("expiryDate").map(String);
    const lines = ids.map((itemId, i) => {
      const q = qty[i]?.trim() ? Number(qty[i]) : 0;
      return { itemId, quantity: Number.isFinite(q) ? q : -1, lotNumber: lots[i] || null, expiryDate: exp[i] || null };
    });
    await receivePurchaseOrder(await getActor(), formString(fd, "poId"), lines);
    refresh();
    return "Réception enregistrée : le stock a été mis à jour.";
  });
}
