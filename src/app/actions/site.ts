"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { clientIp, getActor } from "@/server/current";
import { submitContactMessage } from "@/server/services/contact";
import {
  changeMyPassword, deleteMyAddress, saveMyAddress, updateMyProfile,
} from "@/server/services/customer-account";

export async function contactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    // Champ piège invisible : les robots le remplissent.
    if (formString(fd, "website")) return "Message envoyé.";
    const actor = await getActor();
    await submitContactMessage(
      {
        name: formString(fd, "name"), email: formString(fd, "email"), phone: formString(fd, "phone"),
        subject: formString(fd, "subject"), message: formString(fd, "message"),
      },
      actor?.id ?? null,
      await clientIp(),
    );
    return "Votre message a bien été enregistré. Notre équipe vous répondra dans les meilleurs délais.";
  });
}

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateMyProfile(await getActor(), { fullName: formString(fd, "fullName"), phone: formString(fd, "phone") });
    revalidatePath("/compte");
    return "Informations mises à jour.";
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    await changeMyPassword(await getActor(), {
      current: formString(fd, "current"), next: formString(fd, "next"), confirm: formString(fd, "confirm"),
    });
  });
  // Toutes les sessions sont fermées : reconnexion avec le nouveau mot de passe.
  if (state.ok) redirect("/connexion?next=/compte");
  return state;
}

function addressInput(fd: FormData) {
  return {
    label: formString(fd, "label"), recipient: formString(fd, "recipient"), phone: formString(fd, "phone"),
    city: formString(fd, "city"), district: formString(fd, "district"), line1: formString(fd, "line1"),
    landmark: formString(fd, "landmark"), zoneId: formOptional(fd, "zoneId"), isDefault: fd.get("isDefault") === "on",
  };
}

export async function saveAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = formOptional(fd, "id");
  const state = await runAction(async () => {
    await saveMyAddress(await getActor(), id, addressInput(fd));
    revalidatePath("/compte");
    return "Adresse enregistrée.";
  });
  if (state.ok && id) redirect("/compte#adresses");
  return state;
}

export async function deleteAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteMyAddress(await getActor(), formString(fd, "id"));
    revalidatePath("/compte");
    return "Adresse supprimée.";
  });
}
