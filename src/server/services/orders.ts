/**
 * Panier et commandes.
 *
 * Garanties :
 *  - les prix, remises et frais sont recalculés côté serveur à la validation ;
 *  - le stock est réservé dans la même transaction que la commande (verrou des
 *    lots + contrainte qty_reserved <= qty_on_hand) : aucune survente possible ;
 *  - une même validation envoyée deux fois ne crée qu'une commande (clé d'idempotence) ;
 *  - statuts de commande, de paiement et de livraison sont distincts.
 */
import type { PoolClient } from "pg";
import { formatMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx, type Db } from "../db";
import { UnauthenticatedError, UserError } from "../errors";
import { can } from "../permissions";
import { notify } from "./notifications";
import { getPriceContext, quoteLines, type PriceQuote } from "./pricing";
import { nextDocumentNumber } from "./purchasing";
import { allocateFefo, applyMovement, getAvailability } from "./stock";

export const MAX_CART_LINES = 50;
export const MAX_LINE_QTY = 100_000;

export const ORDER_STATUS = {
  new: "Nouvelle",
  pending_confirmation: "En attente de confirmation",
  confirmed: "Confirmée",
  preparing: "En préparation",
  ready_to_ship: "Prête à expédier",
  out_for_delivery: "En livraison",
  delivered: "Livrée",
  cancelled: "Annulée",
  returned: "Retournée",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

export const PAYMENT_STATUS = {
  awaiting_payment: "En attente de paiement",
  awaiting_verification: "En attente de vérification",
  paid: "Paiement confirmé",
  refused: "Paiement refusé",
  failed: "Paiement échoué",
  refunded: "Remboursé",
  partially_refunded: "Partiellement remboursé",
} as const;

/** Transitions manuelles autorisées (le passage à « Retournée » se fait par un retour). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["pending_confirmation", "confirmed", "cancelled"],
  pending_confirmation: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
  returned: [],
};

/** Statuts que le client peut annuler lui-même ; au-delà, il fait une demande. */
const SELF_CANCEL: OrderStatus[] = ["new", "pending_confirmation"];
const CANCEL_REQUEST: OrderStatus[] = ["confirmed", "preparing"];

type MyCustomer = {
  id: string; user_id: string; status: string; customer_type: "retail" | "business"; full_name: string;
  email: string | null; phone: string | null; business_name: string | null;
};

async function myCustomer(actor: Actor | null, db?: Db, lock = false): Promise<MyCustomer> {
  if (!actor) throw new UnauthenticatedError();
  const c = await queryOne<MyCustomer>(
    `SELECT c.id, c.user_id, c.status, c.customer_type, c.full_name, c.email, c.phone,
            CASE WHEN b.status = 'approved' THEN b.establishment_name END AS business_name
       FROM customers c LEFT JOIN business_accounts b ON b.customer_id = c.id
      WHERE c.user_id = $1 ${lock ? "FOR UPDATE OF c" : ""}`,
    [actor.id], db,
  );
  if (!c) throw new UserError("Seuls les comptes clients peuvent commander.");
  if (c.status !== "active") throw new UserError("Votre compte n'est pas actif.");
  return c;
}

const validQty = (q: number) => Number.isInteger(q) && q >= 1 && q <= MAX_LINE_QTY;

// ---------------------------------------------------------------------------
// Panier
// ---------------------------------------------------------------------------
export async function addToCart(actor: Actor | null, productId: string, quantity: number) {
  if (!validQty(quantity)) throw new UserError("Quantité invalide.");
  await tx(async (db) => {
    const c = await myCustomer(actor, db, true);
    const p = await queryOne<{ status: string; min_order_qty: number; name: string }>(
      "SELECT status, min_order_qty, name FROM products WHERE id = $1", [productId], db,
    );
    if (!p || p.status !== "published") throw new UserError("Ce produit n'est pas disponible à la commande.");
    const existing = await queryOne<{ quantity: number }>(
      "SELECT quantity FROM cart_items WHERE customer_id = $1 AND product_id = $2", [c.id, productId], db,
    );
    if (!existing) {
      const n = (await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM cart_items WHERE customer_id = $1", [c.id], db))!.n;
      if (n >= MAX_CART_LINES) throw new UserError(`Votre panier est limité à ${MAX_CART_LINES} produits différents.`);
    }
    const total = (existing?.quantity ?? 0) + quantity;
    if (total > MAX_LINE_QTY) throw new UserError("Quantité trop élevée.");
    if (total < p.min_order_qty) {
      throw new UserError(`Quantité minimale de commande pour « ${p.name} » : ${p.min_order_qty}.`, { quantity: `Minimum ${p.min_order_qty}` });
    }
    await db.query(
      `INSERT INTO cart_items (customer_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [c.id, productId, total],
    );
  });
}

export async function setCartQuantity(actor: Actor | null, productId: string, quantity: number) {
  const c = await myCustomer(actor);
  if (quantity === 0) {
    await query("DELETE FROM cart_items WHERE customer_id = $1 AND product_id = $2", [c.id, productId]);
    return;
  }
  if (!validQty(quantity)) throw new UserError("Quantité invalide.");
  const res = await query("UPDATE cart_items SET quantity = $3 WHERE customer_id = $1 AND product_id = $2 RETURNING 1", [c.id, productId, quantity]);
  if (res.length === 0) throw new UserError("Produit absent du panier.");
}

export async function cartCount(actor: Actor | null) {
  if (!actor) return 0;
  return (await queryOne<{ n: number }>(
    "SELECT coalesce(sum(1), 0)::int AS n FROM cart_items ci JOIN customers c ON c.id = ci.customer_id WHERE c.user_id = $1",
    [actor.id],
  ))!.n;
}

export type CartLine = {
  product_id: string; name: string; sku: string; slug: string; status: string; min_order_qty: number;
  sale_unit: "piece" | "box" | "pack" | "carton" | "lot"; units_per_sale_unit: number; cover_path: string | null;
  quantity: number; quote: PriceQuote | null; available: number; issue: string | null;
};

export type CartSummary = {
  lines: CartLine[]; subtotalMinor: number; retailSubtotalMinor: number; discountMinor: number; canCheckout: boolean;
};

async function loadCart(customerId: string, ctx: Awaited<ReturnType<typeof getPriceContext>>, db?: Db, lock = false): Promise<CartSummary> {
  const rows = await query<Omit<CartLine, "quote" | "available" | "issue">>(
    `SELECT ci.product_id, ci.quantity, p.name, p.sku, p.slug, p.status, p.min_order_qty, p.sale_unit, p.units_per_sale_unit,
            (SELECT storage_path FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, created_at LIMIT 1) AS cover_path
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.customer_id = $1 ORDER BY ci.added_at ${lock ? "FOR UPDATE OF ci" : ""}`,
    [customerId], db,
  );
  const orderable = rows.filter((r) => r.status === "published");
  const quotes = await quoteLines(ctx, orderable.map((r) => ({ productId: r.product_id, quantity: r.quantity })), new Date(), db);
  const byId = new Map(quotes.map((q) => [q.productId, q]));
  const stock = await getAvailability(rows.map((r) => r.product_id), db);
  const lines: CartLine[] = rows.map((r) => {
    const available = stock.get(r.product_id) ?? 0;
    let issue: string | null = null;
    if (r.status !== "published") issue = "Ce produit n'est plus disponible à la commande.";
    else if (r.quantity < r.min_order_qty) issue = `Quantité minimale : ${r.min_order_qty}.`;
    else if (available < r.quantity) issue = available === 0 ? "Rupture de stock." : `Stock disponible insuffisant : ${available} disponible(s).`;
    return { ...r, quote: byId.get(r.product_id) ?? null, available, issue };
  });
  const valid = lines.filter((l) => l.quote);
  const subtotalMinor = valid.reduce((s, l) => s + l.quote!.lineTotalMinor, 0);
  const retailSubtotalMinor = valid.reduce((s, l) => s + l.quote!.retailUnitPriceMinor * l.quantity, 0);
  return {
    lines, subtotalMinor, retailSubtotalMinor, discountMinor: Math.max(retailSubtotalMinor - subtotalMinor, 0),
    canCheckout: lines.length > 0 && lines.every((l) => !l.issue),
  };
}

export async function getMyCart(actor: Actor | null) {
  const c = await myCustomer(actor);
  return loadCart(c.id, await getPriceContext(actor));
}

export type Zone = {
  id: string; name: string; fee_minor: number; free_shipping_threshold_minor: number | null; fee_mode: "fixed" | "manual";
};

/** Frais de livraison de la zone ; null quand ils sont fixés par l'équipe après la commande. */
export function shippingFee(zone: Zone, subtotalMinor: number): number | null {
  if (zone.fee_mode === "manual") return null;
  return zone.free_shipping_threshold_minor !== null && subtotalMinor >= zone.free_shipping_threshold_minor ? 0 : zone.fee_minor;
}

// ---------------------------------------------------------------------------
// Validation de commande
// ---------------------------------------------------------------------------
export type PlaceOrderInput = {
  addressId: string; paymentMethodCode: string; note?: string | null; idempotencyKey: string; expectedTotalMinor?: number | null;
};

export async function placeOrder(actor: Actor | null, input: PlaceOrderInput) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey ?? "")) throw new UserError("Requête invalide. Rechargez la page.");
  const note = input.note?.trim().slice(0, 1000) || null;
  return tx(async (db) => {
    // Verrou du client : deux validations simultanées du même panier sont sérialisées.
    const c = await myCustomer(actor, db, true);
    const already = await queryOne<{ id: string; number: string; customer_id: string }>(
      "SELECT id, number, customer_id FROM orders WHERE idempotency_key = $1", [input.idempotencyKey], db,
    );
    if (already) {
      if (already.customer_id !== c.id) throw new UserError("Requête invalide. Rechargez la page.");
      return { id: already.id, number: already.number, duplicate: true };
    }

    const ctx = await getPriceContext(actor, db);
    const cart = await loadCart(c.id, ctx, db, true);
    if (cart.lines.length === 0) throw new UserError("Votre panier est vide.");
    const problem = cart.lines.find((l) => l.issue);
    if (problem) throw new UserError(`« ${problem.name} » : ${problem.issue}`);

    const address = await queryOne<{
      recipient: string; phone: string; city: string; district: string | null; line1: string; landmark: string | null;
      zone_id: string | null;
    }>("SELECT recipient, phone, city, district, line1, landmark, zone_id FROM addresses WHERE id = $1 AND customer_id = $2", [input.addressId, c.id], db);
    if (!address) throw new UserError("Choisissez une adresse de livraison.", { addressId: "Adresse requise" });
    const zone = address.zone_id
      ? await queryOne<Zone>("SELECT id, name, fee_minor, free_shipping_threshold_minor, fee_mode FROM delivery_zones WHERE id = $1 AND is_active", [address.zone_id], db)
      : null;
    if (!zone) throw new UserError("Cette adresse n'est rattachée à aucune zone de livraison desservie. Modifiez-la ou choisissez-en une autre.", { addressId: "Zone non desservie" });

    const method = await queryOne<{ code: string; name: string }>(
      "SELECT code, name FROM payment_methods WHERE code = $1 AND is_active", [input.paymentMethodCode ?? ""], db,
    );
    if (!method) throw new UserError("Choisissez un moyen de paiement disponible.", { paymentMethodCode: "Moyen de paiement requis" });

    const fee = shippingFee(zone, cart.subtotalMinor);
    const shippingPending = fee === null;
    const shipping = fee ?? 0;
    const total = cart.subtotalMinor + shipping;
    if (input.expectedTotalMinor != null && input.expectedTotalMinor !== total) {
      throw new UserError(`Le montant de votre commande a changé (nouveau total : ${formatMRU(total)}). Vérifiez le récapitulatif avant de confirmer.`);
    }

    const number = await nextDocumentNumber(db, "order", "CMD");
    const order = await queryOne<{ id: string }>(
      `INSERT INTO orders (number, customer_id, customer_name, customer_email, customer_phone, customer_type, business_name,
                           ship_recipient, ship_phone, ship_city, ship_district, ship_line1, ship_landmark, zone_id, zone_name,
                           subtotal_minor, discount_minor, shipping_minor, total_minor, customer_note, idempotency_key, payment_method_code,
                           shipping_pending)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
      [number, c.id, c.full_name, c.email, c.phone, ctx.isBusiness ? "business" : "retail", c.business_name,
       address.recipient, address.phone, address.city, address.district, address.line1, address.landmark, zone.id, zone.name,
       cart.subtotalMinor, cart.discountMinor, shipping, total, note, input.idempotencyKey, method.code, shippingPending],
      db,
    );
    const orderId = order!.id;

    for (const l of cart.lines) {
      const q = l.quote!;
      const item = await queryOne<{ id: string }>(
        `INSERT INTO order_items (order_id, product_id, sku, name, sale_unit, units_per_sale_unit, quantity, unit_price_minor,
                                  retail_unit_price_minor, price_source, price_label, line_total_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [orderId, l.product_id, l.sku, l.name, l.sale_unit, l.units_per_sale_unit, l.quantity, q.unitPriceMinor,
         q.retailUnitPriceMinor, q.source, q.label, q.lineTotalMinor],
        db,
      );
      // Réservation FEFO : verrouille les lots, la contrainte de base empêche toute sur-réservation.
      for (const a of await allocateFefo(db, l.product_id, l.quantity)) {
        await db.query("UPDATE stock_lots SET qty_reserved = qty_reserved + $2 WHERE id = $1", [a.lotId, a.quantity]);
        await db.query("INSERT INTO inventory_reservations (order_item_id, lot_id, quantity) VALUES ($1, $2, $3)", [item!.id, a.lotId, a.quantity]);
      }
    }
    await db.query(
      "INSERT INTO order_status_history (order_id, from_status, to_status, note, actor_id, actor_name) VALUES ($1, NULL, 'new', 'Commande passée en ligne', $2, $3)",
      [orderId, actor!.id, c.full_name],
    );
    await db.query("DELETE FROM cart_items WHERE customer_id = $1", [c.id]);
    await audit(actor, "order.place", "order", orderId, { after: { number, total, lines: cart.lines.length } }, db);
    await notify(db, c.user_id, `Commande ${number} reçue`,
      shippingPending
        ? `Montant des produits : ${formatMRU(total)} — paiement : ${method.name}. Notre équipe va calculer les frais de livraison selon la quantité et l'adresse, puis vous indiquer le total à payer.`
        : `Montant : ${formatMRU(total)} — paiement : ${method.name}. Notre équipe va la confirmer.`,
      `/compte/commandes/${number}`);
    return { id: orderId, number, duplicate: false, shippingPending };
  });
}

// ---------------------------------------------------------------------------
// Changements de statut
// ---------------------------------------------------------------------------
type LockedOrder = {
  id: string; number: string; status: OrderStatus; customer_id: string; user_id: string | null; stock_consumed_at: Date | null;
  shipping_pending: boolean;
};

async function lockOrder(db: PoolClient, id: string): Promise<LockedOrder> {
  const o = await queryOne<LockedOrder>(
    `SELECT o.id, o.number, o.status, o.customer_id, c.user_id, o.stock_consumed_at, o.shipping_pending
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1 FOR UPDATE OF o`,
    [id], db,
  );
  if (!o) throw new UserError("Commande introuvable.");
  return o;
}

async function releaseReservations(db: PoolClient, orderId: string) {
  const rows = await query<{ id: string; lot_id: string; quantity: number }>(
    `SELECT r.id, r.lot_id, r.quantity FROM inventory_reservations r JOIN order_items i ON i.id = r.order_item_id
      WHERE i.order_id = $1 AND r.status = 'active' FOR UPDATE OF r`,
    [orderId], db,
  );
  for (const r of rows) {
    await db.query("UPDATE stock_lots SET qty_reserved = qty_reserved - $2 WHERE id = $1", [r.lot_id, r.quantity]);
    await db.query("UPDATE inventory_reservations SET status = 'released', resolved_at = now() WHERE id = $1", [r.id]);
  }
}

async function consumeReservations(db: PoolClient, actor: Actor, order: LockedOrder) {
  const rows = await query<{ id: string; lot_id: string; quantity: number }>(
    `SELECT r.id, r.lot_id, r.quantity FROM inventory_reservations r JOIN order_items i ON i.id = r.order_item_id
      WHERE i.order_id = $1 AND r.status = 'active' FOR UPDATE OF r`,
    [order.id], db,
  );
  for (const r of rows) {
    await applyMovement(db, actor, {
      lotId: r.lot_id, type: "sale_out", quantity: -r.quantity, reason: `Commande ${order.number}`, orderId: order.id, fromReservation: true,
    });
    await db.query("UPDATE inventory_reservations SET status = 'consumed', resolved_at = now() WHERE id = $1", [r.id]);
  }
  await db.query("UPDATE orders SET stock_consumed_at = now() WHERE id = $1", [order.id]);
  // La livraison est créée quand la commande est prête à expédier.
  const ship = await queryOne<{ id: string }>(
    "INSERT INTO shipments (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING RETURNING id", [order.id], db,
  );
  if (ship) {
    await db.query("INSERT INTO shipment_events (shipment_id, status, note, actor_id, actor_name) VALUES ($1, 'pending', 'Commande prête à expédier', $2, $3)",
      [ship.id, actor.id, actor.fullName]);
  }
}

/** Met la livraison en cohérence quand l'équipe fait avancer la commande directement. */
async function syncShipment(db: PoolClient, actor: Actor, orderId: string, to: "in_transit" | "delivered", note: string | null) {
  const s = await queryOne<{ id: string; status: string }>("SELECT id, status FROM shipments WHERE order_id = $1 FOR UPDATE", [orderId], db);
  if (!s || s.status === to) return;
  await db.query(
    `UPDATE shipments SET status = $2::delivery_status, delivered_at = CASE WHEN $2::delivery_status = 'delivered' THEN now() ELSE delivered_at END WHERE id = $1`,
    [s.id, to],
  );
  await db.query("INSERT INTO shipment_events (shipment_id, status, note, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5)",
    [s.id, to, note ?? "Mise à jour depuis la commande", actor.id, actor.fullName]);
}

/**
 * Avance la commande depuis le module livraison (départ, livraison effectuée).
 * Appelée dans la transaction de la livraison.
 */
export async function advanceOrderForDelivery(db: PoolClient, actor: Actor, orderId: string, to: "out_for_delivery" | "delivered", note: string | null) {
  const order = await lockOrder(db, orderId);
  if (order.status === to) return;
  if (!TRANSITIONS[order.status]?.includes(to)) {
    throw new UserError(`La commande est « ${ORDER_STATUS[order.status]} » : passage à « ${ORDER_STATUS[to]} » impossible.`);
  }
  if (to === "delivered") await db.query("UPDATE orders SET delivered_at = now() WHERE id = $1", [orderId]);
  await recordStatus(db, actor, order, to, note);
}

async function recordStatus(db: PoolClient, actor: Actor, order: LockedOrder, to: OrderStatus, note: string | null) {
  await db.query("UPDATE orders SET status = $2 WHERE id = $1", [order.id, to]);
  await db.query(
    "INSERT INTO order_status_history (order_id, from_status, to_status, note, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,$6)",
    [order.id, order.status, to, note, actor.id, actor.fullName],
  );
  await audit(actor, "order.status_change", "order", order.id, { before: { status: order.status }, after: { status: to, note } }, db);
  await notify(db, order.user_id, `Commande ${order.number} : ${ORDER_STATUS[to].toLowerCase()}`, note, `/compte/commandes/${order.number}`);
}

async function cancelInTx(db: PoolClient, actor: Actor, order: LockedOrder, reason: string) {
  const invoice = await queryOne<{ number: string | null; status: string }>(
    "SELECT number, status FROM invoices WHERE order_id = $1 AND kind = 'invoice' AND status <> 'cancelled'", [order.id], db,
  );
  if (invoice) {
    throw new UserError(invoice.status === "draft"
      ? "Une facture brouillon existe pour cette commande : supprimez-la avant d'annuler."
      : `La facture ${invoice.number} a été émise : annulez-la ou émettez un avoir avant d'annuler la commande.`);
  }
  await releaseReservations(db, order.id);
  await db.query(
    "UPDATE orders SET cancelled_at = now(), cancel_reason = $2, cancel_requested_at = NULL, cancel_request_reason = NULL WHERE id = $1",
    [order.id, reason],
  );
  await recordStatus(db, actor, order, "cancelled", reason);
}

export async function changeOrderStatus(actor: Actor | null, orderId: string, to: OrderStatus, note: string | null) {
  assertCan(actor, "orders.manage");
  const text = note?.trim().slice(0, 1000) || null;
  await tx(async (db) => {
    const order = await lockOrder(db, orderId);
    if (!TRANSITIONS[order.status]?.includes(to)) {
      throw new UserError(`Passage de « ${ORDER_STATUS[order.status]} » à « ${ORDER_STATUS[to] ?? to} » non autorisé.`);
    }
    if (to === "cancelled") {
      if (!text) throw new UserError("Indiquez le motif d'annulation.", { note: "Motif requis" });
      await cancelInTx(db, actor, order, text);
      return;
    }
    if (order.shipping_pending) throw new UserError("Fixez d'abord les frais de livraison de cette commande.", { shipping: "Frais à fixer" });
    if (to === "ready_to_ship") await consumeReservations(db, actor, order);
    if (to === "out_for_delivery") await syncShipment(db, actor, order.id, "in_transit", text);
    if (to === "delivered") {
      await db.query("UPDATE orders SET delivered_at = now() WHERE id = $1", [order.id]);
      await syncShipment(db, actor, order.id, "delivered", text);
    }
    await recordStatus(db, actor, order, to, text);
  });
}

/**
 * Fixe (ou corrige) les frais de livraison d'une commande avant sa confirmation :
 * selon la quantité et l'adresse, quand la zone est en frais manuels.
 * Refusé dès qu'une facture existe ou qu'un paiement a été déclaré ou reçu.
 */
export async function setOrderShipping(actor: Actor | null, orderId: string, amountMinor: number, note: string | null) {
  assertCan(actor, "orders.manage");
  if (!Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > 100_000_000) {
    throw new UserError("Montant des frais invalide.", { shipping: "Montant invalide" });
  }
  const text = note?.trim().slice(0, 500) || null;
  await tx(async (db) => {
    const order = await lockOrder(db, orderId);
    if (!["new", "pending_confirmation"].includes(order.status)) {
      throw new UserError("Les frais de livraison ne peuvent être modifiés qu'avant la confirmation de la commande.");
    }
    const invoice = await queryOne("SELECT 1 FROM invoices WHERE order_id = $1 AND status <> 'cancelled'", [orderId], db);
    if (invoice) throw new UserError("Une facture existe pour cette commande : modifiez les frais sur la facture brouillon ou annulez-la d'abord.");
    const payment = await queryOne("SELECT 1 FROM payments WHERE order_id = $1 AND status IN ('pending_verification', 'confirmed')", [orderId], db);
    if (payment) throw new UserError("Un paiement a déjà été déclaré ou reçu pour cette commande : les frais ne peuvent plus être modifiés.");
    const before = (await queryOne<{ shipping_minor: number; total_minor: number; shipping_pending: boolean }>(
      "SELECT shipping_minor, total_minor, shipping_pending FROM orders WHERE id = $1", [orderId], db,
    ))!;
    const after = (await queryOne<{ total_minor: number }>(
      `UPDATE orders SET shipping_minor = $2, total_minor = subtotal_minor + $2, shipping_pending = false
        WHERE id = $1 RETURNING total_minor`, [orderId, amountMinor], db,
    ))!;
    const label = `Frais de livraison fixés : ${formatMRU(amountMinor)} — total à payer : ${formatMRU(after.total_minor)}`;
    await db.query(
      "INSERT INTO order_status_history (order_id, from_status, to_status, note, actor_id, actor_name) VALUES ($1,$2,$2,$3,$4,$5)",
      [orderId, order.status, text ? `${label} (${text})` : label, actor.id, actor.fullName],
    );
    await audit(actor, "order.shipping_set", "order", orderId, { before, after: { shipping_minor: amountMinor, total_minor: after.total_minor, note: text } }, db);
    await notify(db, order.user_id, `Commande ${order.number} : frais de livraison fixés`,
      `Frais de livraison : ${formatMRU(amountMinor)}. Total à payer : ${formatMRU(after.total_minor)}.${text ? ` ${text}` : ""}`,
      `/compte/commandes/${order.number}`);
  });
}

/** Rejette une demande d'annulation du client (la commande continue). */
export async function rejectCancelRequest(actor: Actor | null, orderId: string, note: string) {
  assertCan(actor, "orders.manage");
  if (!note.trim()) throw new UserError("Indiquez la réponse au client.", { note: "Réponse requise" });
  await tx(async (db) => {
    const order = await lockOrder(db, orderId);
    const r = await db.query("UPDATE orders SET cancel_requested_at = NULL, cancel_request_reason = NULL WHERE id = $1 AND cancel_requested_at IS NOT NULL", [orderId]);
    if (r.rowCount === 0) throw new UserError("Aucune demande d'annulation en cours.");
    await db.query(
      "INSERT INTO order_status_history (order_id, from_status, to_status, note, actor_id, actor_name) VALUES ($1,$2,$2,$3,$4,$5)",
      [orderId, order.status, `Demande d'annulation refusée : ${note.trim()}`, actor.id, actor.fullName],
    );
    await audit(actor, "order.cancel_request_rejected", "order", orderId, { after: { note } }, db);
    await notify(db, order.user_id, `Commande ${order.number} : demande d'annulation refusée`, note.trim(), `/compte/commandes/${order.number}`);
  });
}

// ---------------------------------------------------------------------------
// Actions du client
// ---------------------------------------------------------------------------
async function myOrderForUpdate(db: PoolClient, actor: Actor | null, number: string) {
  const c = await myCustomer(actor, db);
  const o = await queryOne<{ id: string }>("SELECT id FROM orders WHERE number = $1 AND customer_id = $2", [number, c.id], db);
  if (!o) throw new UserError("Commande introuvable.");
  return lockOrder(db, o.id);
}

/** Annulation directe si la commande n'est pas encore confirmée ; sinon demande à l'équipe. */
export async function cancelMyOrder(actor: Actor | null, number: string, reason: string) {
  const why = reason.trim().slice(0, 1000);
  if (why.length < 3) throw new UserError("Indiquez le motif d'annulation.", { reason: "Motif requis" });
  return tx(async (db) => {
    const order = await myOrderForUpdate(db, actor, number);
    if (SELF_CANCEL.includes(order.status)) {
      await cancelInTx(db, actor!, order, `Annulée par le client : ${why}`);
      return "cancelled" as const;
    }
    if (CANCEL_REQUEST.includes(order.status)) {
      const r = await db.query(
        "UPDATE orders SET cancel_requested_at = now(), cancel_request_reason = $2 WHERE id = $1 AND cancel_requested_at IS NULL",
        [order.id, why],
      );
      if (r.rowCount === 0) throw new UserError("Une demande d'annulation est déjà en cours.");
      await audit(actor, "order.cancel_request", "order", order.id, { after: { reason: why } }, db);
      return "requested" as const;
    }
    throw new UserError("Cette commande ne peut plus être annulée. Une fois livrée, vous pourrez demander un retour.");
  });
}

export async function requestReturn(actor: Actor | null, number: string, reason: string) {
  const why = reason.trim().slice(0, 2000);
  if (why.length < 5) throw new UserError("Décrivez le motif du retour.", { reason: "Motif requis" });
  await tx(async (db) => {
    const order = await myOrderForUpdate(db, actor, number);
    if (order.status !== "delivered") throw new UserError("Un retour ne peut être demandé que pour une commande livrée.");
    const policy = await queryOne<{ days: number; delivered_at: Date | null }>(
      "SELECT s.return_window_days AS days, o.delivered_at FROM store_settings s, orders o WHERE s.id = 1 AND o.id = $1", [order.id], db,
    );
    if (!policy || policy.days === 0) throw new UserError("Les retours ne sont pas ouverts en ligne. Contactez-nous.");
    if (policy.delivered_at && Date.now() - new Date(policy.delivered_at).getTime() > policy.days * 86_400_000) {
      throw new UserError(`Le délai de retour de ${policy.days} jour(s) après livraison est dépassé. Contactez-nous.`);
    }
    const open = await queryOne("SELECT 1 FROM returns WHERE order_id = $1 AND status IN ('requested', 'accepted')", [order.id], db);
    if (open) throw new UserError("Une demande de retour est déjà en cours pour cette commande.");
    const row = await queryOne<{ id: string }>("INSERT INTO returns (order_id, reason) VALUES ($1, $2) RETURNING id", [order.id, why], db);
    await audit(actor, "return.request", "order", order.id, { after: { returnId: row!.id, reason: why } }, db);
  });
}

/** Remet au panier les produits d'une commande précédente encore disponibles. */
export async function reorder(actor: Actor | null, number: string) {
  const c = await myCustomer(actor);
  const items = await query<{ product_id: string; quantity: number; status: string }>(
    `SELECT i.product_id, i.quantity, p.status FROM order_items i JOIN orders o ON o.id = i.order_id
       JOIN products p ON p.id = i.product_id WHERE o.number = $1 AND o.customer_id = $2`,
    [number, c.id],
  );
  if (items.length === 0) throw new UserError("Commande introuvable.");
  let added = 0;
  for (const i of items.filter((x) => x.status === "published")) {
    await addToCart(actor, i.product_id, i.quantity).then(() => added++, () => undefined);
  }
  return { added, skipped: items.length - added };
}

// ---------------------------------------------------------------------------
// Retours (équipe)
// ---------------------------------------------------------------------------
export async function decideReturn(actor: Actor | null, returnId: string, accept: boolean, note: string | null) {
  assertCan(actor, "orders.manage");
  const text = note?.trim() || null;
  if (!accept && !text) throw new UserError("Indiquez le motif du refus.", { note: "Motif requis" });
  await tx(async (db) => {
    const r = await queryOne<{ order_id: string; status: string }>("SELECT order_id, status FROM returns WHERE id = $1 FOR UPDATE", [returnId], db);
    if (!r || r.status !== "requested") throw new UserError("Demande de retour introuvable ou déjà traitée.");
    const order = await lockOrder(db, r.order_id);
    await db.query("UPDATE returns SET status = $2, decision_note = $3, decided_at = now(), decided_by = $4 WHERE id = $1",
      [returnId, accept ? "accepted" : "refused", text, actor.id]);
    await audit(actor, accept ? "return.accept" : "return.refuse", "order", order.id, { after: { returnId, note: text } }, db);
    await notify(db, order.user_id, `Commande ${order.number} : retour ${accept ? "accepté" : "refusé"}`, text, `/compte/commandes/${order.number}`);
  });
}

/** Réception du retour : la commande passe « Retournée » ; remise en stock facultative. */
export async function completeReturn(actor: Actor | null, returnId: string, restock: boolean) {
  assertCan(actor, "orders.manage");
  if (restock) assertCan(actor, "stock.manage");
  await tx(async (db) => {
    const r = await queryOne<{ order_id: string; status: string }>("SELECT order_id, status FROM returns WHERE id = $1 FOR UPDATE", [returnId], db);
    if (!r || r.status !== "accepted") throw new UserError("Seul un retour accepté peut être réceptionné.");
    const order = await lockOrder(db, r.order_id);
    if (restock) {
      const consumed = await query<{ lot_id: string; quantity: number }>(
        `SELECT r.lot_id, r.quantity FROM inventory_reservations r JOIN order_items i ON i.id = r.order_item_id
          WHERE i.order_id = $1 AND r.status = 'consumed'`, [order.id], db,
      );
      for (const c of consumed) {
        await applyMovement(db, actor, { lotId: c.lot_id, type: "return_in", quantity: c.quantity, reason: `Retour commande ${order.number}`, orderId: order.id });
      }
    }
    await db.query("UPDATE returns SET status = 'completed', restocked = $2, completed_at = now() WHERE id = $1", [returnId, restock]);
    await recordStatus(db, actor, order, "returned", restock ? "Retour réceptionné, produits remis en stock" : "Retour réceptionné, produits non remis en stock");
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------
export type OrderRow = {
  id: string; number: string; status: OrderStatus; payment_status: keyof typeof PAYMENT_STATUS; customer_id: string;
  customer_name: string; customer_type: "retail" | "business"; business_name: string | null; total_minor: number;
  item_count: number; placed_at: Date; cancel_requested_at: Date | null; open_return: boolean; shipping_pending: boolean;
};

const ORDER_LIST = `
  SELECT o.id, o.number, o.status, o.payment_status, o.customer_id, o.customer_name, o.customer_type, o.business_name,
         o.total_minor, o.placed_at, o.cancel_requested_at, o.shipping_pending,
         (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
         EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id AND r.status IN ('requested', 'accepted')) AS open_return
    FROM orders o`;

export async function listMyOrders(actor: Actor | null) {
  const c = await myCustomer(actor);
  return query<OrderRow>(`${ORDER_LIST} WHERE o.customer_id = $1 ORDER BY o.placed_at DESC LIMIT 200`, [c.id]);
}

export type OrderDetail = OrderRow & {
  customer_email: string | null; customer_phone: string | null; ship_recipient: string; ship_phone: string; ship_city: string;
  ship_district: string | null; ship_line1: string; ship_landmark: string | null; zone_name: string; subtotal_minor: number;
  discount_minor: number; shipping_minor: number; customer_note: string | null; cancel_reason: string | null;
  cancel_request_reason: string | null; stock_consumed_at: Date | null; delivered_at: Date | null; payment_method_code: string | null;
};

async function orderDetail(where: string, args: unknown[]) {
  const order = await queryOne<OrderDetail>(`${ORDER_LIST.replace("o.cancel_requested_at,", "o.cancel_requested_at, o.*,")} WHERE ${where}`, args);
  if (!order) return null;
  const items = await query<{
    id: string; product_id: string; sku: string; name: string; sale_unit: string; units_per_sale_unit: number; quantity: number;
    unit_price_minor: number; retail_unit_price_minor: number; price_label: string; line_total_minor: number; slug: string;
  }>(
    `SELECT i.*, p.slug FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.name`,
    [order.id],
  );
  const history = await query<{ id: number; from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; actor_name: string | null; created_at: Date }>(
    "SELECT id, from_status, to_status, note, actor_name, created_at FROM order_status_history WHERE order_id = $1 ORDER BY id",
    [order.id],
  );
  const returns = await query<{ id: string; status: string; reason: string; decision_note: string | null; requested_at: Date; restocked: boolean | null }>(
    "SELECT id, status, reason, decision_note, requested_at, restocked FROM returns WHERE order_id = $1 ORDER BY requested_at DESC",
    [order.id],
  );
  const invoices = await query<{ id: string; kind: "invoice" | "credit_note"; number: string | null; status: string; total_minor: number }>(
    "SELECT id, kind, number, status, total_minor FROM invoices WHERE order_id = $1 ORDER BY created_at", [order.id],
  );
  return { order, items, history, returns, invoices };
}

/** Détail d'une commande du client connecté (jamais celle d'un autre client). */
export async function getMyOrder(actor: Actor | null, number: string) {
  const c = await myCustomer(actor);
  const data = await orderDetail("o.number = $1 AND o.customer_id = $2", [number, c.id]);
  if (!data) return null;
  // Le client ne voit que ses factures émises.
  return { ...data, invoices: data.invoices.filter((i) => i.status !== "draft") };
}

export async function adminGetOrder(actor: Actor | null, id: string) {
  assertCan(actor, "orders.read");
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const data = await orderDetail("o.id = $1", [id]);
  if (!data) return null;
  const reservations = await query<{ name: string; lot_number: string | null; expiry_date: string | null; quantity: number; status: string }>(
    `SELECT i.name, l.lot_number, l.expiry_date, r.quantity, r.status FROM inventory_reservations r
       JOIN order_items i ON i.id = r.order_item_id JOIN stock_lots l ON l.id = r.lot_id
      WHERE i.order_id = $1 ORDER BY i.name, l.expiry_date NULLS LAST`, [id],
  );
  return { ...data, reservations, canManage: can(actor.roles, "orders.manage") };
}

export async function adminListOrders(actor: Actor | null, f: { q?: string; status?: string; flag?: string; page?: number }) {
  assertCan(actor, "orders.read");
  const pageSize = 25;
  const page = Math.max(Math.trunc(f.page ?? 1), 1);
  const args: unknown[] = [];
  const where = ["true"];
  if (f.q?.trim()) {
    args.push(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(o.number ILIKE $${args.length} OR o.customer_name ILIKE $${args.length} OR o.business_name ILIKE $${args.length} OR o.customer_phone ILIKE $${args.length})`);
  }
  if (f.status === "open") where.push("o.status IN ('new', 'pending_confirmation', 'confirmed', 'preparing', 'ready_to_ship', 'out_for_delivery')");
  else if (f.status && f.status in ORDER_STATUS) {
    args.push(f.status);
    where.push(`o.status = $${args.length}::order_status`);
  }
  if (f.flag === "cancel_request") where.push("o.cancel_requested_at IS NOT NULL");
  if (f.flag === "shipping") where.push("o.shipping_pending AND o.status <> 'cancelled'");
  if (f.flag === "return") where.push("EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id AND r.status IN ('requested', 'accepted'))");
  const w = where.join(" AND ");
  const total = (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM orders o WHERE ${w}`, args))!.n;
  const items = await query<OrderRow>(`${ORDER_LIST} WHERE ${w} ORDER BY o.placed_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listCustomerOrders(actor: Actor | null, customerId: string) {
  assertCan(actor, "customers.read");
  return query<OrderRow>(`${ORDER_LIST} WHERE o.customer_id = $1 ORDER BY o.placed_at DESC LIMIT 100`, [customerId]);
}
