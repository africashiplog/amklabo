"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import { reviewBusinessAccount } from "@/server/services/business";
import {
  addCustomerNote, anonymizeCustomer, createCustomer, deleteCustomer, setCustomerStatus, updateCustomer,
} from "@/server/services/customers";

function customerInput(fd: FormData) {
  return {
    fullName: formString(fd, "fullName"), email: formString(fd, "email"), phone: formString(fd, "phone"),
    customerType: formString(fd, "customerType") === "business" ? ("business" as const) : ("retail" as const),
  };
}

export async function createCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    id = await createCustomer(await getActor(), customerInput(fd));
  });
  if (state.ok) redirect(`/admin/clients/${id}`);
  return state;
}

export async function updateCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateCustomer(await getActor(), formString(fd, "id"), customerInput(fd));
    revalidatePath("/admin/clients");
    return "Fiche client mise à jour.";
  });
}

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addCustomerNote(await getActor(), formString(fd, "customerId"), formString(fd, "body"));
    revalidatePath("/admin/clients");
    return "Note ajoutée.";
  });
}

export async function setCustomerStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = formString(fd, "status");
    await setCustomerStatus(await getActor(), formString(fd, "id"), s === "archived" ? "archived" : s === "suspended" ? "suspended" : "active");
    revalidatePath("/admin/clients");
    return "Statut mis à jour.";
  });
}

export async function deleteCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    await deleteCustomer(await getActor(), formString(fd, "id"));
  });
  if (state.ok) redirect("/admin/clients?supprime=1");
  return state;
}

export async function anonymizeCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await anonymizeCustomer(await getActor(), formString(fd, "id"));
    revalidatePath("/admin/clients");
    return "Données personnelles anonymisées.";
  });
}

export async function reviewBusinessAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const decision = formString(fd, "decision") as "approve" | "reject" | "suspend" | "reinstate";
    await reviewBusinessAccount(await getActor(), formString(fd, "id"), decision, formOptional(fd, "reason"));
    revalidatePath("/", "layout");
    return { approve: "Compte professionnel approuvé.", reject: "Demande refusée.", suspend: "Compte professionnel suspendu.", reinstate: "Compte professionnel rétabli." }[decision];
  });
}
