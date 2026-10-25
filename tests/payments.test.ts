import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { createProduct } from "@/server/services/catalog";
import { saveMyAddress } from "@/server/services/customer-account";
import { assignShipment, completeDelivery, failDelivery, getShipment, listMyDeliveries, startDelivery } from "@/server/services/deliveries";
import { adminGetInvoice, cancelInvoice, createInvoiceFromOrder, issueInvoice } from "@/server/services/invoices";
import { addToCart, changeOrderStatus, getMyOrder, placeOrder } from "@/server/services/orders";
import {
  derivePaymentStatus, listMyOrderPayments, recordPayment, recordRefund, saveMethod, submitPayment, verifyPayment,
} from "@/server/services/payments";
import { recordEntry } from "@/server/services/stock";
import { saveZone } from "@/server/services/zones";
import { baseProduct, firstCategoryId, makeActor, makeCustomer } from "./helpers";

type A = Awaited<ReturnType<typeof makeActor>>;
const ref = () => `TX${randomUUID().slice(0, 10).replace(/-/g, "")}`;

async function enableBankily(admin: A) {
  await saveMethod(admin, "bankily", { isActive: true, merchantAccount: "COMPTE-TEST-0000", instructions: "Instructions de test", referenceLabel: "Numéro de transaction" });
}

async function order(method = "cash_on_delivery", qty = 2) {
  const admin = await makeActor(["admin"]);
  if (method === "bankily") await enableBankily(admin);
  const { id: productId } = await createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: "1000", trackLots: false }));
  await recordEntry(admin, { productId, type: "manual_in", quantity: "20", lotNumber: "", expiryDate: "", supplierId: null, unitCost: "", reason: "Init" });
  await saveZone(admin, null, { name: `Zone ${randomUUID().slice(0, 6)}`, city: "Nouakchott", fee: "100", freeThreshold: "", isActive: true });
  const zoneId = (await pool().query("SELECT id FROM delivery_zones WHERE is_active ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  const c = await makeCustomer();
  await saveMyAddress(c, null, { label: "Maison", recipient: "Client Paiement", phone: "+222 22 00 00 03", city: "Nouakchott", line1: "Rue 3", zoneId, isDefault: true });
  const addressId = (await pool().query("SELECT a.id FROM addresses a JOIN customers c ON c.id = a.customer_id WHERE c.user_id = $1", [c.id])).rows[0].id;
  await addToCart(c, productId, qty);
  const o = await placeOrder(c, { paymentMethodCode: method, addressId, idempotencyKey: randomUUID().replace(/-/g, "") });
  return { admin, c, ...o }; // total = qty × 1000 + 100 MRU
}

describe("moyens de paiement", () => {
  it("un moyen électronique ne peut pas être activé sans compte marchand", async () => {
    const admin = await makeActor(["admin"]);
    await expect(saveMethod(admin, "masrivi", { isActive: true, merchantAccount: "", referenceLabel: "Référence" })).rejects.toThrow(/compte marchand/);
    await expect(saveMethod(await makeActor(["accountant"]), "masrivi", { isActive: false, referenceLabel: "Référence" })).rejects.toThrow(ForbiddenError);
  });

  it("refuse une commande avec un moyen de paiement inactif", async () => {
    await pool().query("UPDATE payment_methods SET is_active = false WHERE code = 'sedad'");
    await expect(order("sedad")).rejects.toThrow(/moyen de paiement/);
  });
});

describe("paiement électronique avec vérification manuelle", () => {
  it("déclaration → en attente de vérification → confirmation par le comptable", async () => {
    const { c, id, number } = await order("bankily");
    const reference = ref();
    await submitPayment(c, number, { reference, payerPhone: "+222 22 11 11 11" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("awaiting_verification");
    const [p] = await listMyOrderPayments(c, number);
    expect([p.status, p.amount_minor]).toEqual(["pending_verification", 210000]);
    // Jamais confirmé automatiquement ; un gestionnaire de stock ne peut rien confirmer.
    await expect(verifyPayment(await makeActor(["stock_manager"]), p.id, "confirm", {})).rejects.toThrow(ForbiddenError);
    await expect(verifyPayment(await makeActor(["order_manager"]), p.id, "confirm", {})).rejects.toThrow(ForbiddenError);
    const accountant = await makeActor(["accountant"]);
    await verifyPayment(accountant, p.id, "confirm", { note: "Vu sur le relevé" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("paid");
    const row = (await pool().query("SELECT verified_by, verified_at FROM payments WHERE id = $1", [p.id])).rows[0];
    expect(row.verified_by).toBe(accountant.id);
    expect(row.verified_at).not.toBeNull();
    void id;
  });

  it("un paiement ne peut pas être confirmé deux fois, même simultanément", async () => {
    const { c, number } = await order("bankily");
    await submitPayment(c, number, { reference: ref() });
    const [p] = await listMyOrderPayments(c, number);
    const accountant = await makeActor(["accountant"]);
    const results = await Promise.allSettled([1, 2, 3].map(() => verifyPayment(accountant, p.id, "confirm", {})));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(pool().query("UPDATE payments SET amount_minor = 1 WHERE id = $1", [p.id])).rejects.toThrow(/déjà été traité/);
    await expect(pool().query("DELETE FROM payments WHERE id = $1", [p.id])).rejects.toThrow(/permission denied/);
    await expect(pool().query("UPDATE payment_events SET note = 'x' WHERE payment_id = $1", [p.id])).rejects.toThrow(/permission denied/);
  });

  it("une même référence de transaction ne peut pas servir deux fois", async () => {
    const a = await order("bankily");
    const b = await order("bankily");
    const reference = ref();
    await submitPayment(a.c, a.number, { reference });
    await expect(submitPayment(b.c, b.number, { reference: reference.toLowerCase() })).rejects.toThrow(/déjà été utilisée/);
  });

  it("refus motivé : le client peut transmettre une nouvelle référence", async () => {
    const { c, number } = await order("bankily");
    await submitPayment(c, number, { reference: ref() });
    const [p] = await listMyOrderPayments(c, number);
    const accountant = await makeActor(["accountant"]);
    await expect(verifyPayment(accountant, p.id, "refuse", {})).rejects.toThrow(/motif/);
    await verifyPayment(accountant, p.id, "refuse", { note: "Transaction introuvable sur le compte" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("refused");
    await submitPayment(c, number, { reference: ref() });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("awaiting_verification");
  });

  it("montant reçu partiel, puis solde ; report automatique sur la facture", async () => {
    const { admin, c, id, number } = await order("bankily");
    await submitPayment(c, number, { reference: ref() });
    const [p] = await listMyOrderPayments(c, number);
    const accountant = await makeActor(["accountant"]);
    await verifyPayment(accountant, p.id, "confirm", { amount: "1000" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("partially_paid");
    await changeOrderStatus(admin, id, "confirmed", null);
    const inv = await createInvoiceFromOrder(admin, id);
    await issueInvoice(admin, inv);
    expect((await adminGetInvoice(admin, inv))!.invoice.amount_paid_minor).toBe(100000);
    await expect(cancelInvoice(admin, inv, "Test")).rejects.toThrow(/règlement/);
    await expect(recordPayment(accountant, { orderId: id }, { methodCode: "bankily", amount: "2000", reference: ref() })).rejects.toThrow(/reste à payer/);
    await recordPayment(accountant, { orderId: id }, { methodCode: "bankily", amount: "1100", reference: ref() });
    expect((await adminGetInvoice(admin, inv))!.invoice.amount_paid_minor).toBe(210000);
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("paid");
  });

  it("remboursement partiel puis total", async () => {
    const { c, id, number } = await order("bankily");
    const accountant = await makeActor(["accountant"]);
    await recordPayment(accountant, { orderId: id }, { methodCode: "bankily", amount: "2100", reference: ref() });
    await expect(recordRefund(accountant, { orderId: id }, { methodCode: "bankily", amount: "500" })).rejects.toThrow(/motif/);
    await expect(recordRefund(accountant, { orderId: id }, { methodCode: "bankily", amount: "3000", note: "Trop" })).rejects.toThrow(/dépasse/);
    await recordRefund(accountant, { orderId: id }, { methodCode: "bankily", amount: "500", note: "Produit manquant" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("partially_refunded");
    await recordRefund(accountant, { orderId: id }, { methodCode: "bankily", amount: "1600", note: "Retour complet" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("refunded");
  });

  it("un client ne peut pas déclarer un paiement sur la commande d'un autre", async () => {
    const a = await order("bankily");
    const other = await makeCustomer();
    await expect(submitPayment(other, a.number, { reference: ref() })).rejects.toThrow(/introuvable/);
  });

  it("le paiement à la livraison ne se déclare pas en ligne", async () => {
    const { c, number } = await order("cash_on_delivery");
    await expect(submitPayment(c, number, { reference: ref() })).rejects.toThrow(/ne nécessite pas/);
  });

  it("dérivation des statuts", () => {
    const t = (paid: number, refunded = 0, pending = 0, lastRefused = false) => ({ paid, refunded, pending, lastRefused });
    expect(derivePaymentStatus(100, t(0))).toBe("awaiting_payment");
    expect(derivePaymentStatus(100, t(0, 0, 100))).toBe("awaiting_verification");
    expect(derivePaymentStatus(100, t(40))).toBe("partially_paid");
    expect(derivePaymentStatus(100, t(100))).toBe("paid");
    expect(derivePaymentStatus(100, t(0, 0, 0, true))).toBe("refused");
    expect(derivePaymentStatus(100, t(100, 30))).toBe("partially_refunded");
    expect(derivePaymentStatus(100, t(100, 100))).toBe("refunded");
  });
});

describe("livraisons", () => {
  async function readyOrder(method = "cash_on_delivery") {
    const o = await order(method);
    for (const s of ["confirmed", "preparing", "ready_to_ship"] as const) await changeOrderStatus(o.admin, o.id, s, null);
    const shipmentId = (await pool().query("SELECT id FROM shipments WHERE order_id = $1", [o.id])).rows[0].id as string;
    return { ...o, shipmentId };
  }

  it("livraison créée à « Prête à expédier », affectée à un livreur qui ne voit que les siennes", async () => {
    const { admin, shipmentId } = await readyOrder();
    const driver = await makeActor(["delivery"]);
    const otherDriver = await makeActor(["delivery"]);
    await expect(assignShipment(admin, shipmentId, { driverId: (await makeActor(["accountant"])).id })).rejects.toThrow(/livreur/);
    await assignShipment(admin, shipmentId, { driverId: driver.id, scheduledFor: "2030-01-15" });
    expect((await listMyDeliveries(driver)).map((s) => s.id)).toContain(shipmentId);
    expect((await listMyDeliveries(otherDriver)).map((s) => s.id)).not.toContain(shipmentId);
    expect(await getShipment(otherDriver, shipmentId)).toBeNull();
    await expect(startDelivery(otherDriver, shipmentId)).rejects.toThrow(ForbiddenError);
    await expect(assignShipment(driver, shipmentId, { driverId: driver.id })).rejects.toThrow(ForbiddenError);
    const view = (await getShipment(driver, shipmentId))!;
    expect(view.amountToCollect).toBe(210000);
  });

  it("paiement à la livraison : encaissement déclaré par le livreur, confirmé par le comptable", async () => {
    const { admin, c, number, shipmentId } = await readyOrder();
    const driver = await makeActor(["delivery"]);
    await assignShipment(admin, shipmentId, { driverId: driver.id });
    await startDelivery(driver, shipmentId);
    expect((await getMyOrder(c, number))!.order.status).toBe("out_for_delivery");
    await expect(completeDelivery(driver, shipmentId, {})).rejects.toThrow(/montant encaissé/);
    await expect(completeDelivery(driver, shipmentId, { collected: "5000" })).rejects.toThrow(/dépasse/);
    await completeDelivery(driver, shipmentId, { collected: "2100" });
    const o = (await getMyOrder(c, number))!;
    expect(o.order.status).toBe("delivered");
    // Pas encore « payé » : la remise des espèces doit être confirmée.
    expect(o.order.payment_status).toBe("awaiting_verification");
    const [p] = await listMyOrderPayments(c, number);
    await expect(verifyPayment(driver, p.id, "confirm", {})).rejects.toThrow(ForbiddenError);
    await verifyPayment(await makeActor(["accountant"]), p.id, "confirm", { note: "Espèces remises en caisse" });
    expect((await getMyOrder(c, number))!.order.payment_status).toBe("paid");
  });

  it("échec de livraison puis nouvelle tentative", async () => {
    const { admin, c, number, shipmentId } = await readyOrder("bankily");
    const driver = await makeActor(["delivery"]);
    await assignShipment(admin, shipmentId, { driverId: driver.id });
    await startDelivery(driver, shipmentId);
    await expect(failDelivery(driver, shipmentId, "")).rejects.toThrow(UserError);
    await failDelivery(driver, shipmentId, "Client absent");
    expect((await getMyOrder(c, number))!.order.status).toBe("out_for_delivery");
    await startDelivery(driver, shipmentId);
    await completeDelivery(driver, shipmentId, { note: "Remis au client" }); // paiement électronique : rien à encaisser
    expect((await getMyOrder(c, number))!.order.status).toBe("delivered");
    const events = (await getShipment(admin, shipmentId))!.events.map((e) => e.status);
    expect(events).toEqual(["pending", "assigned", "in_transit", "failed", "in_transit", "delivered"]);
    await expect(pool().query("DELETE FROM shipment_events WHERE shipment_id = $1", [shipmentId])).rejects.toThrow(/permission denied/);
  });

  it("statuts de commande, paiement et livraison restent distincts", async () => {
    const { admin, c, id, number, shipmentId } = await readyOrder("bankily");
    await changeOrderStatus(admin, id, "out_for_delivery", null);
    const s = (await pool().query("SELECT status FROM shipments WHERE id = $1", [shipmentId])).rows[0].status;
    const o = (await getMyOrder(c, number))!.order;
    expect([o.status, o.payment_status, s]).toEqual(["out_for_delivery", "awaiting_payment", "in_transit"]);
  });
});
