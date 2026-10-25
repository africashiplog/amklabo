/**
 * Livraisons. Une livraison est créée quand la commande est « Prête à expédier ».
 * Le statut de livraison est distinct des statuts de commande et de paiement ;
 * les étapes « En livraison » et « Livrée » de la commande en découlent.
 * Un livreur n'accède qu'aux livraisons qui lui sont attribuées, avec les seules
 * informations nécessaires (pas d'historique client, pas de données financières hors montant à encaisser).
 */
import type { PoolClient } from "pg";
import { parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx } from "../db";
import { ForbiddenError, UnauthenticatedError, UserError } from "../errors";
import { can } from "../permissions";
import { notify } from "./notifications";
import { advanceOrderForDelivery } from "./orders";
import { declareCashCollected, orderAmountDue } from "./payments";

export const DELIVERY_STATUS = {
  pending: "À planifier",
  assigned: "Affectée",
  in_transit: "En cours de livraison",
  delivered: "Livrée",
  failed: "Échec de livraison",
  cancelled: "Annulée",
} as const;
export type DeliveryStatus = keyof typeof DELIVERY_STATUS;

export type ShipmentRow = {
  id: string; order_id: string; order_number: string; status: DeliveryStatus; driver_id: string | null; driver_name: string | null;
  carrier_name: string | null; tracking_number: string | null; scheduled_for: string | null; assigned_at: Date | null;
  delivered_at: Date | null; failed_reason: string | null; created_at: Date;
  customer_name: string; business_name: string | null; ship_recipient: string; ship_phone: string; ship_city: string;
  ship_district: string | null; ship_line1: string; ship_landmark: string | null; zone_name: string; customer_note: string | null;
  payment_method_code: string | null; payment_status: string;
};

const SELECT = `
  SELECT s.*, o.number AS order_number, p.full_name AS driver_name, o.customer_name, o.business_name, o.ship_recipient,
         o.ship_phone, o.ship_city, o.ship_district, o.ship_line1, o.ship_landmark, o.zone_name, o.customer_note,
         o.payment_method_code, o.payment_status
    FROM shipments s JOIN orders o ON o.id = s.order_id LEFT JOIN profiles p ON p.user_id = s.driver_id`;

async function shipmentEvent(db: PoolClient, shipmentId: string, status: DeliveryStatus, actor: Actor | null, note: string | null) {
  await db.query(
    "INSERT INTO shipment_events (shipment_id, status, note, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5)",
    [shipmentId, status, note, actor?.id ?? null, actor?.fullName ?? null],
  );
}

export async function listDrivers(actor: Actor | null) {
  assertCan(actor, "deliveries.manage");
  return query<{ id: string; full_name: string; phone: string | null }>(
    `SELECT u.id, p.full_name, p.phone FROM users u JOIN profiles p ON p.user_id = u.id
      JOIN user_roles r ON r.user_id = u.id AND r.role = 'delivery' WHERE u.status = 'active' ORDER BY p.full_name`,
  );
}

type AssignInput = { driverId?: string | null; carrierName?: string | null; trackingNumber?: string | null; scheduledFor?: string | null };

function parseAssign(d: AssignInput) {
  const clean = (v?: string | null, max = 120) => (v?.trim() ? v.trim().slice(0, max) : null);
  const scheduledFor = clean(d.scheduledFor, 10);
  if (scheduledFor && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) throw new UserError("Date invalide.", { scheduledFor: "Date invalide" });
  const tracking = clean(d.trackingNumber, 80);
  if (tracking && !/^[A-Za-z0-9._/ -]{2,80}$/.test(tracking)) throw new UserError("Numéro de suivi invalide.", { trackingNumber: "Format invalide" });
  return { driverId: clean(d.driverId, 36), carrierName: clean(d.carrierName), trackingNumber: tracking, scheduledFor };
}

/** Affecte un livreur (ou un transporteur avec numéro de suivi). */
export async function assignShipment(actor: Actor | null, shipmentId: string, input: AssignInput) {
  assertCan(actor, "deliveries.manage");
  const d = parseAssign(input);
  if (!d.driverId && !d.carrierName) throw new UserError("Choisissez un livreur ou indiquez un transporteur.", { driverId: "Livreur ou transporteur requis" });
  await tx(async (db) => {
    const s = await queryOne<{ status: DeliveryStatus; order_number: string; driver_id: string | null }>(
      "SELECT s.status, o.number AS order_number, s.driver_id FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s",
      [shipmentId], db,
    );
    if (!s) throw new UserError("Livraison introuvable.");
    if (!["pending", "assigned", "failed"].includes(s.status)) throw new UserError("Cette livraison ne peut plus être réaffectée.");
    if (d.driverId) {
      const ok = await queryOne(
        "SELECT 1 FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'delivery' WHERE u.id = $1 AND u.status = 'active'", [d.driverId], db,
      );
      if (!ok) throw new UserError("Ce livreur n'existe pas ou n'est pas actif.", { driverId: "Livreur invalide" });
    }
    await db.query(
      `UPDATE shipments SET status = 'assigned', driver_id = $2, carrier_name = $3, tracking_number = $4, scheduled_for = $5,
              assigned_at = now(), failed_reason = NULL WHERE id = $1`,
      [shipmentId, d.driverId, d.carrierName, d.trackingNumber, d.scheduledFor],
    );
    await shipmentEvent(db, shipmentId, "assigned", actor, [d.carrierName && `Transporteur : ${d.carrierName}`, d.trackingNumber && `Suivi : ${d.trackingNumber}`].filter(Boolean).join(" · ") || null);
    await audit(actor, "delivery.assign", "shipment", shipmentId, { before: { status: s.status, driver: s.driver_id }, after: d }, db);
    if (d.driverId && d.driverId !== s.driver_id) {
      await notify(db, d.driverId, `Nouvelle livraison : ${s.order_number}`, null, `/admin/livraisons/${shipmentId}`);
    }
  });
}

async function loadForActor(db: PoolClient, actor: Actor, shipmentId: string) {
  const s = await queryOne<{ status: DeliveryStatus; driver_id: string | null; order_id: string; payment_method_code: string | null }>(
    "SELECT s.status, s.driver_id, s.order_id, o.payment_method_code FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s",
    [shipmentId], db,
  );
  if (!s) throw new UserError("Livraison introuvable.");
  const manager = can(actor.roles, "deliveries.manage");
  if (!manager && !(can(actor.roles, "deliveries.own") && s.driver_id === actor.id)) throw new ForbiddenError();
  return s;
}

/** Départ en livraison. */
export async function startDelivery(actor: Actor | null, shipmentId: string) {
  if (!actor) throw new UnauthenticatedError();
  await tx(async (db) => {
    const s = await loadForActor(db, actor, shipmentId);
    if (!["assigned", "failed"].includes(s.status) && !(s.status === "pending" && can(actor.roles, "deliveries.manage"))) {
      throw new UserError("La livraison doit d'abord être affectée.");
    }
    await db.query("UPDATE shipments SET status = 'in_transit' WHERE id = $1", [shipmentId]);
    await shipmentEvent(db, shipmentId, "in_transit", actor, null);
    await advanceOrderForDelivery(db, actor, s.order_id, "out_for_delivery", null);
    await audit(actor, "delivery.start", "shipment", shipmentId, { before: { status: s.status } }, db);
  });
}

/**
 * Livraison effectuée. Pour un paiement à la livraison, le livreur déclare les
 * espèces encaissées : le paiement reste « en attente de vérification » jusqu'à
 * la confirmation de la remise en caisse par le comptable.
 */
export async function completeDelivery(actor: Actor | null, shipmentId: string, input: { collected?: string | null; note?: string | null }) {
  if (!actor) throw new UnauthenticatedError();
  const note = input.note?.trim().slice(0, 500) || null;
  await tx(async (db) => {
    const s = await loadForActor(db, actor, shipmentId);
    if (s.status !== "in_transit") throw new UserError("La livraison n'est pas en cours.");
    if (s.payment_method_code === "cash_on_delivery") {
      const due = await orderAmountDue(db, s.order_id);
      if (due > 0) {
        const collected = parseMRU(input.collected?.trim() || "");
        if (collected === null) throw new UserError("Indiquez le montant encaissé (0 si rien n'a été encaissé).", { collected: "Montant requis" });
        if (collected === 0 && !note) throw new UserError("Expliquez pourquoi aucun montant n'a été encaissé.", { note: "Explication requise" });
        await declareCashCollected(db, actor, s.order_id, collected, note);
      }
    }
    await db.query("UPDATE shipments SET status = 'delivered', delivered_at = now() WHERE id = $1", [shipmentId]);
    await shipmentEvent(db, shipmentId, "delivered", actor, note);
    await advanceOrderForDelivery(db, actor, s.order_id, "delivered", note);
    await audit(actor, "delivery.complete", "shipment", shipmentId, { after: { collected: input.collected ?? null, note } }, db);
  });
}

export async function failDelivery(actor: Actor | null, shipmentId: string, reason: string) {
  if (!actor) throw new UnauthenticatedError();
  const why = reason.trim().slice(0, 500);
  if (why.length < 3) throw new UserError("Indiquez la raison de l'échec.", { reason: "Raison requise" });
  await tx(async (db) => {
    const s = await loadForActor(db, actor, shipmentId);
    if (s.status !== "in_transit") throw new UserError("La livraison n'est pas en cours.");
    await db.query("UPDATE shipments SET status = 'failed', failed_reason = $2 WHERE id = $1", [shipmentId, why]);
    await shipmentEvent(db, shipmentId, "failed", actor, why);
    await audit(actor, "delivery.fail", "shipment", shipmentId, { after: { reason: why } }, db);
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------
export async function adminListShipments(actor: Actor | null, status?: string) {
  assertCan(actor, "deliveries.manage");
  const where = status === "active" || !status
    ? "s.status IN ('pending', 'assigned', 'in_transit', 'failed')"
    : status in DELIVERY_STATUS ? "s.status = $1::delivery_status" : "true";
  const args = status && status in DELIVERY_STATUS ? [status] : [];
  return query<ShipmentRow>(`${SELECT} WHERE ${where} ORDER BY s.scheduled_for NULLS LAST, s.created_at LIMIT 300`, args);
}

/** Livraisons du livreur connecté : uniquement les siennes. */
export async function listMyDeliveries(actor: Actor | null) {
  assertCan(actor, "deliveries.own");
  return query<ShipmentRow>(
    `${SELECT} WHERE s.driver_id = $1 AND (s.status IN ('assigned', 'in_transit', 'failed') OR s.delivered_at > now() - interval '7 days')
      ORDER BY (s.status = 'delivered'), s.scheduled_for NULLS LAST, s.assigned_at`,
    [actor.id],
  );
}

/** Fiche de livraison (gestionnaire, ou livreur affecté uniquement). */
export async function getShipment(actor: Actor | null, id: string) {
  if (!actor) throw new UnauthenticatedError();
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const s = await queryOne<ShipmentRow>(`${SELECT} WHERE s.id = $1`, [id]);
  if (!s) return null;
  const manager = can(actor.roles, "deliveries.manage");
  if (!manager && !(can(actor.roles, "deliveries.own") && s.driver_id === actor.id)) return null;
  const items = await query<{ name: string; sku: string; quantity: number; sale_unit: string; units_per_sale_unit: number }>(
    "SELECT name, sku, quantity, sale_unit, units_per_sale_unit FROM order_items WHERE order_id = $1 ORDER BY name", [s.order_id],
  );
  const events = await query<{ id: number; status: DeliveryStatus; note: string | null; actor_name: string | null; created_at: Date }>(
    "SELECT id, status, note, actor_name, created_at FROM shipment_events WHERE shipment_id = $1 ORDER BY id", [id],
  );
  const collect = s.payment_method_code === "cash_on_delivery" ? await orderAmountDue(undefined, s.order_id) : 0;
  return { shipment: s, items, events, amountToCollect: collect, canManage: manager };
}

export async function getShipmentForOrder(orderId: string) {
  return queryOne<{ id: string; status: DeliveryStatus; carrier_name: string | null; tracking_number: string | null; scheduled_for: string | null; delivered_at: Date | null; failed_reason: string | null }>(
    "SELECT id, status, carrier_name, tracking_number, scheduled_for, delivered_at, failed_reason FROM shipments WHERE order_id = $1", [orderId],
  );
}
