import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { createProduct } from "@/server/services/catalog";
import { saveMyAddress } from "@/server/services/customer-account";
import {
  addToCart, cancelMyOrder, changeOrderStatus, completeReturn, decideReturn, getMyCart, getMyOrder, placeOrder,
  rejectCancelRequest, reorder, requestReturn,
} from "@/server/services/orders";
import { addTier } from "@/server/services/pricing";
import { getAvailability, getProductStock, recordEntry, recordExit } from "@/server/services/stock";
import { saveZone } from "@/server/services/zones";
import { baseProduct, firstCategoryId, makeActor, makeCustomer } from "./helpers";

type A = Awaited<ReturnType<typeof makeActor>>;

async function zone(admin: A, fee = "200", free = "") {
  await saveZone(admin, null, { name: `Zone ${randomUUID().slice(0, 6)}`, city: "Nouakchott", fee, freeThreshold: free, isActive: true });
  return (await pool().query("SELECT id FROM delivery_zones WHERE is_active ORDER BY created_at DESC LIMIT 1")).rows[0].id as string;
}

async function setup(stock = 10, price = "1000") {
  const admin = await makeActor(["admin"]);
  const { id: productId } = await createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: price, trackLots: false }));
  if (stock) {
    await recordEntry(admin, { productId, type: "manual_in", quantity: String(stock), lotNumber: "", expiryDate: "", supplierId: null, unitCost: "", reason: "Init" });
  }
  const zoneId = await zone(admin);
  return { admin, productId, zoneId };
}

async function customerWithAddress(zoneId: string) {
  const c = await makeCustomer();
  await saveMyAddress(c, null, { label: "Domicile", recipient: "Client Test", phone: "+222 22 00 00 01", city: "Nouakchott", line1: "Rue 1", zoneId, isDefault: true });
  const { rows } = await pool().query("SELECT a.id FROM addresses a JOIN customers c ON c.id = a.customer_id WHERE c.user_id = $1", [c.id]);
  return { c, addressId: rows[0].id as string };
}

const key = () => randomUUID().replace(/-/g, "");

describe("panier et validation", () => {
  it("crée une commande avec prix serveur, frais de livraison, réservation de stock et copie historique", async () => {
    const { admin, productId, zoneId } = await setup(10);
    await addTier(admin, productId, { audience: "all", minQty: "3", unitPrice: "900" });
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 3);
    const cart = await getMyCart(c);
    expect(cart.subtotalMinor).toBe(270000);
    expect(cart.discountMinor).toBe(30000);
    const { number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    expect(number).toMatch(/^CMD-\d{4}-\d{4}$/);
    const o = (await getMyOrder(c, number))!;
    expect([o.order.subtotal_minor, o.order.shipping_minor, o.order.total_minor]).toEqual([270000, 20000, 290000]);
    expect(o.order.status).toBe("new");
    expect(o.order.payment_status).toBe("awaiting_payment");
    expect(o.items[0]).toMatchObject({ quantity: 3, unit_price_minor: 90000, retail_unit_price_minor: 100000, price_label: "Tarif quantité dès 3" });
    expect((await getAvailability([productId])).get(productId)).toBe(7);
    expect((await getMyCart(c)).lines).toHaveLength(0);
    // Le prix du produit change ensuite : la commande garde le prix d'achat.
    await pool().query("UPDATE products SET retail_price_minor = 500000, name = 'Nom modifié' WHERE id = $1", [productId]);
    const again = (await getMyOrder(c, number))!;
    expect([again.items[0].unit_price_minor, again.order.total_minor]).toEqual([90000, 290000]);
    expect(again.items[0].name).not.toBe("Nom modifié");
  });

  it("livraison gratuite au-delà du seuil de la zone", async () => {
    const { admin, productId } = await setup(10);
    const zoneId = await zone(admin, "300", "2000");
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 2);
    const { number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    expect((await getMyOrder(c, number))!.order.shipping_minor).toBe(0);
  });

  it("la double soumission ne crée qu'une seule commande", async () => {
    const { productId, zoneId } = await setup(10);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 1);
    const k = key();
    const [a, b] = await Promise.all([placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: k }), placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: k })]);
    expect(a.number).toBe(b.number);
    const { rows } = await pool().query("SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1", [k]);
    expect(rows[0].n).toBe(1);
    expect((await getAvailability([productId])).get(productId)).toBe(9);
  });

  it("aucune survente lors de commandes simultanées de clients différents", async () => {
    const { productId, zoneId } = await setup(5);
    const buyers = await Promise.all(Array.from({ length: 4 }, () => customerWithAddress(zoneId)));
    for (const b of buyers) await addToCart(b.c, productId, 2);
    const results = await Promise.allSettled(buyers.map((b) => placeOrder(b.c, { paymentMethodCode: "cash_on_delivery", addressId: b.addressId, idempotencyKey: key() })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof UserError)).toBe(true);
    expect((await getAvailability([productId])).get(productId)).toBe(1);
  });

  it("refuse : panier vide, stock insuffisant, produit non publié, zone non desservie, total modifié", async () => {
    const { admin, productId, zoneId } = await setup(2);
    const { c, addressId } = await customerWithAddress(zoneId);
    await expect(placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() })).rejects.toThrow(/vide/);
    await addToCart(c, productId, 3);
    await expect(placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() })).rejects.toThrow(/insuffisant/);
    await pool().query("UPDATE cart_items SET quantity = 1 FROM customers WHERE customers.id = cart_items.customer_id AND customers.user_id = $1", [c.id]);
    await expect(placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key(), expectedTotalMinor: 1 })).rejects.toThrow(/a changé/);
    await pool().query("UPDATE delivery_zones SET is_active = false WHERE id = $1", [zoneId]);
    await expect(placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() })).rejects.toThrow(/zone/);
    await pool().query("UPDATE delivery_zones SET is_active = true WHERE id = $1", [zoneId]);
    await pool().query("UPDATE products SET status = 'unavailable' WHERE id = $1", [productId]);
    await expect(placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() })).rejects.toThrow(/plus disponible/);
    await expect(addToCart(c, productId, 1)).rejects.toThrow(/pas disponible/);
    void admin;
  });

  it("le personnel ne peut pas commander pour lui-même via le panier client", async () => {
    const { productId } = await setup(2);
    await expect(addToCart(await makeActor(["admin"]), productId, 1)).rejects.toThrow(/comptes clients/);
  });

  it("une sortie manuelle ne peut pas consommer le stock réservé", async () => {
    const { admin, productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 4);
    await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    await expect(recordExit(admin, { productId, lotId: null, type: "loss", quantity: "2", reason: "Casse" })).rejects.toThrow(/insuffisant/);
    await recordExit(admin, { productId, lotId: null, type: "loss", quantity: "1", reason: "Casse" });
    await expect(pool().query("UPDATE stock_lots SET qty_on_hand = 3 WHERE product_id = $1", [productId])).rejects.toThrow(/check/i);
  });
});

describe("cycle de vie de la commande", () => {
  it("transitions contrôlées, sortie de stock à la préparation, historique et notifications", async () => {
    const { admin, productId, zoneId } = await setup(10);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 4);
    const { id, number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    await expect(changeOrderStatus(admin, id, "delivered", null)).rejects.toThrow(/non autorisé/);
    for (const s of ["confirmed", "preparing", "ready_to_ship"] as const) await changeOrderStatus(admin, id, s, null);
    const st = (await getProductStock(admin, productId))!;
    expect([st.product.physical, st.product.reserved, st.product.on_hand]).toEqual([6, 0, 6]);
    expect(st.movements[0]).toMatchObject({ movement_type: "sale_out", quantity: -4, order_number: number });
    await expect(changeOrderStatus(admin, id, "cancelled", "Trop tard")).rejects.toThrow(/non autorisé/);
    await changeOrderStatus(admin, id, "out_for_delivery", null);
    await changeOrderStatus(admin, id, "delivered", "Remis en main propre");
    const o = (await getMyOrder(c, number))!;
    expect(o.history.map((h) => h.to_status)).toEqual(["new", "confirmed", "preparing", "ready_to_ship", "out_for_delivery", "delivered"]);
    expect(o.order.payment_status).toBe("awaiting_payment"); // statuts indépendants
    const n = await pool().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1", [c.id]);
    expect(n.rows[0].n).toBe(6);
    await expect(pool().query("UPDATE order_status_history SET note = 'x' WHERE order_id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("annulation : par le client avant confirmation, libère la réservation", async () => {
    const { productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 5);
    const { number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    expect((await getAvailability([productId])).get(productId)).toBe(0);
    expect(await cancelMyOrder(c, number, "Erreur de quantité")).toBe("cancelled");
    expect((await getAvailability([productId])).get(productId)).toBe(5);
    expect((await getMyOrder(c, number))!.order.status).toBe("cancelled");
  });

  it("après confirmation, le client fait une demande ; l'équipe accepte ou refuse", async () => {
    const { admin, productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 1);
    const { id, number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    await changeOrderStatus(admin, id, "confirmed", null);
    expect(await cancelMyOrder(c, number, "Plus besoin")).toBe("requested");
    await expect(cancelMyOrder(c, number, "Encore")).rejects.toThrow(/déjà en cours/);
    await rejectCancelRequest(admin, id, "Commande déjà préparée");
    expect((await getMyOrder(c, number))!.order.cancel_requested_at).toBeNull();
    await changeOrderStatus(admin, id, "cancelled", "Annulation acceptée après échange");
    expect((await getAvailability([productId])).get(productId)).toBe(5);
  });

  it("un client ne voit et n'agit que sur ses propres commandes", async () => {
    const { productId, zoneId } = await setup(5);
    const a = await customerWithAddress(zoneId);
    const b = await customerWithAddress(zoneId);
    await addToCart(a.c, productId, 1);
    const { number } = await placeOrder(a.c, { paymentMethodCode: "cash_on_delivery", addressId: a.addressId, idempotencyKey: key() });
    expect(await getMyOrder(b.c, number)).toBeNull();
    await expect(cancelMyOrder(b.c, number, "Pirate")).rejects.toThrow(/introuvable/);
    await expect(placeOrder(b.c, { paymentMethodCode: "cash_on_delivery", addressId: a.addressId, idempotencyKey: key() })).rejects.toThrow();
  });

  it("seuls les gestionnaires des commandes et administrateurs changent les statuts", async () => {
    const { productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 1);
    const { id } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    for (const r of ["stock_manager", "accountant", "delivery"] as const) {
      await expect(changeOrderStatus(await makeActor([r]), id, "confirmed", null)).rejects.toThrow(ForbiddenError);
    }
    await expect(changeOrderStatus(c, id, "confirmed", null)).rejects.toThrow(ForbiddenError);
    await changeOrderStatus(await makeActor(["order_manager"]), id, "confirmed", null);
  });

  it("retour : demande, acceptation, réception avec remise en stock", async () => {
    const { admin, productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 2);
    const { id, number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    await expect(requestReturn(c, number, "Produit abîmé")).rejects.toThrow(/livrée/);
    for (const s of ["confirmed", "preparing", "ready_to_ship", "out_for_delivery", "delivered"] as const) await changeOrderStatus(admin, id, s, null);
    await requestReturn(c, number, "Boîte endommagée à la livraison");
    const r = (await getMyOrder(c, number))!.returns[0];
    await expect(completeReturn(admin, r.id, true)).rejects.toThrow(/accepté/);
    await decideReturn(admin, r.id, true, "Retour accepté");
    await completeReturn(admin, r.id, true);
    expect((await getMyOrder(c, number))!.order.status).toBe("returned");
    expect((await getAvailability([productId])).get(productId)).toBe(5);
  });

  it("recommander remet les produits disponibles au panier", async () => {
    const { productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 2);
    const { number } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    expect(await reorder(c, number)).toEqual({ added: 1, skipped: 0 });
    expect((await getMyCart(c)).lines[0].quantity).toBe(2);
  });

  it("un produit commandé ne peut plus être supprimé", async () => {
    const { productId, zoneId } = await setup(5);
    const { c, addressId } = await customerWithAddress(zoneId);
    await addToCart(c, productId, 1);
    await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: key() });
    await expect(pool().query("DELETE FROM products WHERE id = $1", [productId])).rejects.toThrow(/foreign key/);
  });
});
