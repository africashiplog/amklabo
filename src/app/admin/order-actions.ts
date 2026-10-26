"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import {
  addInvoiceLine, cancelInvoice, createCreditNote, createInvoiceFromOrder, createManualInvoice, deleteDraft, issueInvoice,
  setInvoiceLineQuantity, updateDraft,
} from "@/server/services/invoices";
import { changeOrderStatus, completeReturn, decideReturn, rejectCancelRequest, setOrderShipping, type OrderStatus } from "@/server/services/orders";
import { parseMRU } from "@/lib/money";
import { UserError } from "@/server/errors";

const refresh = () => revalidatePath("/", "layout");

export async function changeOrderStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await changeOrderStatus(await getActor(), formString(fd, "orderId"), formString(fd, "to") as OrderStatus, formOptional(fd, "note"));
    refresh();
    return "Statut mis à jour.";
  });
}

export async function rejectCancelRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await rejectCancelRequest(await getActor(), formString(fd, "orderId"), formString(fd, "note"));
    refresh();
    return "Demande refusée, le client est informé.";
  });
}

export async function decideReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await decideReturn(await getActor(), formString(fd, "returnId"), formString(fd, "decision") === "accept", formOptional(fd, "note"));
    refresh();
    return "Décision enregistrée.";
  });
}

export async function completeReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await completeReturn(await getActor(), formString(fd, "returnId"), formString(fd, "restock") === "yes");
    refresh();
    return "Retour réceptionné.";
  });
}

export async function createInvoiceFromOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    id = await createInvoiceFromOrder(await getActor(), formString(fd, "orderId"));
  });
  if (state.ok) redirect(`/admin/factures/${id}`);
  return state;
}

export async function createManualInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    id = await createManualInvoice(await getActor(), formString(fd, "customerId"));
  });
  if (state.ok) redirect(`/admin/factures/${id}`);
  return state;
}

export async function createCreditNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    id = await createCreditNote(await getActor(), formString(fd, "invoiceId"));
  });
  if (state.ok) redirect(`/admin/factures/${id}`);
  return state;
}

export async function updateDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateDraft(await getActor(), formString(fd, "invoiceId"), {
      notes: formString(fd, "notes"), shipping: formString(fd, "shipping"), buyerName: formString(fd, "buyerName"),
      buyerBusiness: formString(fd, "buyerBusiness"), buyerAddress: formString(fd, "buyerAddress"),
      buyerProfessionalId: formString(fd, "buyerProfessionalId"),
    });
    revalidatePath("/admin/factures");
    return "Brouillon enregistré.";
  });
}

export async function addInvoiceLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addInvoiceLine(await getActor(), formString(fd, "invoiceId"), {
      description: formString(fd, "description"), sku: formString(fd, "sku"), unitLabel: formString(fd, "unitLabel") || "pièce",
      quantity: formString(fd, "quantity"), unitPrice: formString(fd, "unitPrice"),
    });
    revalidatePath("/admin/factures");
    return "Ligne ajoutée.";
  });
}

export async function setInvoiceLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const q = fd.get("remove") ? 0 : Number(formString(fd, "quantity"));
    await setInvoiceLineQuantity(await getActor(), formString(fd, "lineId"), q);
    revalidatePath("/admin/factures");
    return q === 0 ? "Ligne supprimée." : "Ligne mise à jour.";
  });
}

export async function issueInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const n = await issueInvoice(await getActor(), formString(fd, "invoiceId"));
    refresh();
    return `Document émis sous le numéro ${n}.`;
  });
}

export async function cancelInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cancelInvoice(await getActor(), formString(fd, "invoiceId"), formString(fd, "reason"));
    refresh();
    return "Facture annulée.";
  });
}

export async function deleteDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    await deleteDraft(await getActor(), formString(fd, "invoiceId"));
  });
  if (state.ok) redirect("/admin/factures?supprime=1");
  return state;
}

export async function setOrderShippingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const amount = parseMRU(formString(fd, "shipping"));
    if (amount === null) throw new UserError("Montant des frais invalide.", { shipping: "Montant invalide" });
    await setOrderShipping(await getActor(), formString(fd, "orderId"), amount, formOptional(fd, "note"));
    refresh();
    return "Frais de livraison enregistrés, le client est notifié.";
  });
}
