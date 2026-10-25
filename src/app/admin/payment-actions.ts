"use server";

import { revalidatePath } from "next/cache";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import { assignShipment, completeDelivery, failDelivery, startDelivery } from "@/server/services/deliveries";
import { recordPayment, recordRefund, saveMethod, verifyPayment } from "@/server/services/payments";

const refresh = () => revalidatePath("/", "layout");

function target(fd: FormData) {
  return { orderId: formOptional(fd, "orderId"), invoiceId: formOptional(fd, "invoiceId") };
}

export async function verifyPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const decision = formString(fd, "decision") === "refuse" ? "refuse" : "confirm";
    await verifyPayment(await getActor(), formString(fd, "paymentId"), decision, { amount: formOptional(fd, "amount"), note: formOptional(fd, "note") });
    refresh();
    return decision === "confirm" ? "Paiement confirmé." : "Paiement refusé.";
  });
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await recordPayment(await getActor(), target(fd), {
      methodCode: formString(fd, "methodCode"), amount: formString(fd, "amount"), reference: formString(fd, "reference"), note: formString(fd, "note"),
    });
    refresh();
    return "Règlement enregistré.";
  });
}

export async function recordRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await recordRefund(await getActor(), target(fd), {
      methodCode: formString(fd, "methodCode"), amount: formString(fd, "amount"), reference: formString(fd, "reference"), note: formString(fd, "note"),
    });
    refresh();
    return "Remboursement enregistré.";
  });
}

export async function saveMethodAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await saveMethod(await getActor(), formString(fd, "code"), {
      isActive: fd.get("isActive") === "on", instructions: formString(fd, "instructions"),
      merchantAccount: formString(fd, "merchantAccount"), referenceLabel: formString(fd, "referenceLabel") || "Référence de la transaction",
    });
    refresh();
    return "Moyen de paiement enregistré.";
  });
}

export async function assignShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await assignShipment(await getActor(), formString(fd, "shipmentId"), {
      driverId: formOptional(fd, "driverId"), carrierName: formOptional(fd, "carrierName"),
      trackingNumber: formOptional(fd, "trackingNumber"), scheduledFor: formOptional(fd, "scheduledFor"),
    });
    refresh();
    return "Livraison affectée.";
  });
}

export async function startDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await startDelivery(await getActor(), formString(fd, "shipmentId"));
    refresh();
    return "Livraison en cours.";
  });
}

export async function completeDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await completeDelivery(await getActor(), formString(fd, "shipmentId"), { collected: formOptional(fd, "collected"), note: formOptional(fd, "note") });
    refresh();
    return "Livraison enregistrée.";
  });
}

export async function failDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await failDelivery(await getActor(), formString(fd, "shipmentId"), formString(fd, "reason"));
    refresh();
    return "Échec enregistré.";
  });
}
