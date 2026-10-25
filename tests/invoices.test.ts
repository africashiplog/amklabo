import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { createProduct } from "@/server/services/catalog";
import { saveMyAddress } from "@/server/services/customer-account";
import {
  addInvoiceLine, adminGetInvoice, cancelInvoice, createCreditNote, createInvoiceFromOrder, createManualInvoice, deleteDraft,
  getInvoiceForViewer, includedTax, issueInvoice, listMyInvoices, setInvoiceLineQuantity, updateDraft,
} from "@/server/services/invoices";
import { addToCart, changeOrderStatus, placeOrder } from "@/server/services/orders";
import { getStoreSettings } from "@/server/services/settings";
import { recordEntry } from "@/server/services/stock";
import { saveZone } from "@/server/services/zones";
import { baseProduct, firstCategoryId, makeActor, makeCustomer } from "./helpers";

async function confirmedOrder() {
  const admin = await makeActor(["admin"]);
  const { id: productId } = await createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: "1500", trackLots: false }));
  await recordEntry(admin, { productId, type: "manual_in", quantity: "20", lotNumber: "", expiryDate: "", supplierId: null, unitCost: "", reason: "Init" });
  await saveZone(admin, null, { name: `Zone ${randomUUID().slice(0, 6)}`, city: "Nouakchott", fee: "100", freeThreshold: "", isActive: true });
  const zoneId = (await pool().query("SELECT id FROM delivery_zones WHERE is_active ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  const c = await makeCustomer();
  await saveMyAddress(c, null, { label: "Bureau", recipient: "Client Facture", phone: "+222 22 00 00 02", city: "Nouakchott", line1: "Rue 2", zoneId, isDefault: true });
  const addressId = (await pool().query("SELECT a.id FROM addresses a JOIN customers c ON c.id = a.customer_id WHERE c.user_id = $1", [c.id])).rows[0].id;
  await addToCart(c, productId, 4);
  const { id: orderId } = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: randomUUID().replace(/-/g, "") });
  return { admin, c, orderId };
}

describe("factures", () => {
  it("brouillon depuis une commande confirmée, émission avec numéro définitif et données figées", async () => {
    const { admin, c, orderId } = await confirmedOrder();
    await expect(createInvoiceFromOrder(admin, orderId)).rejects.toThrow(/confirmée/);
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    await expect(createInvoiceFromOrder(admin, orderId)).rejects.toThrow(/déjà une facture/);
    let inv = (await adminGetInvoice(admin, id))!;
    expect([inv.invoice.status, inv.invoice.number, inv.invoice.subtotal_minor, inv.invoice.shipping_minor, inv.invoice.total_minor])
      .toEqual(["draft", null, 600000, 10000, 610000]);
    // Le client ne voit pas les brouillons.
    expect(await getInvoiceForViewer(c, id)).toBeNull();
    expect(await listMyInvoices(c)).toHaveLength(0);

    const number = await issueInvoice(admin, id);
    expect(number).toMatch(/^FAC-\d{4}-\d{4}$/);
    inv = (await adminGetInvoice(admin, id))!;
    expect(inv.invoice.seller?.store_name).toBe("AMKLABO");
    // Un changement de paramètres après émission ne modifie pas la facture.
    await pool().query("UPDATE store_settings SET store_name = 'Autre nom' WHERE id = 1");
    expect((await adminGetInvoice(admin, id))!.invoice.seller?.store_name).toBe("AMKLABO");
    await pool().query("UPDATE store_settings SET store_name = 'AMKLABO' WHERE id = 1");
    expect((await getInvoiceForViewer(c, id))!.invoice.number).toBe(number);
    expect(await listMyInvoices(c)).toHaveLength(1);
  });

  it("une facture émise ne peut être ni modifiée, ni supprimée, même directement en base", async () => {
    const { admin, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    await issueInvoice(admin, id);
    await expect(updateDraft(admin, id, { buyerName: "Autre", shipping: "0" })).rejects.toThrow(/brouillon/);
    await expect(deleteDraft(admin, id)).rejects.toThrow(/brouillon/);
    await expect(pool().query("UPDATE invoices SET total_minor = 1, subtotal_minor = 1, shipping_minor = 0 WHERE id = $1", [id])).rejects.toThrow(/ne peut pas être modifiée/);
    await expect(pool().query("UPDATE invoice_items SET quantity = 1, line_total_minor = unit_price_minor WHERE invoice_id = $1", [id])).rejects.toThrow(/émise/);
    await expect(pool().query("DELETE FROM invoices WHERE id = $1", [id])).rejects.toThrow(/supprimée/);
    const owner = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    try {
      await expect(owner.query("UPDATE invoices SET status = 'draft' WHERE id = $1", [id])).rejects.toThrow(/brouillon/);
    } finally {
      await owner.end();
    }
  });

  it("annulation documentée ; le numéro n'est jamais réutilisé ; nouvelle facture possible", async () => {
    const { admin, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    const n1 = await issueInvoice(admin, id);
    await expect(cancelInvoice(admin, id, "")).rejects.toThrow(/motif/);
    await expect(changeOrderStatus(admin, orderId, "cancelled", "Test")).rejects.toThrow(/avoir/);
    await cancelInvoice(admin, id, "Erreur d'adresse de facturation");
    const inv = (await adminGetInvoice(admin, id))!.invoice;
    expect([inv.status, inv.number, inv.cancel_reason, inv.cancelled_by_name]).toEqual(["cancelled", n1, "Erreur d'adresse de facturation", admin.fullName]);
    await expect(pool().query("UPDATE invoices SET status = 'issued' WHERE id = $1", [id])).rejects.toThrow(/définitive/);
    const id2 = await createInvoiceFromOrder(admin, orderId);
    const n2 = await issueInvoice(admin, id2);
    expect(n2).not.toBe(n1);
    const log = await pool().query("SELECT actor_id FROM audit_logs WHERE entity_id = $1 AND action = 'invoice.cancel'", [id]);
    expect(log.rows[0].actor_id).toBe(admin.id);
  });

  it("refuse l'annulation si un règlement est enregistré", async () => {
    const { admin, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    await issueInvoice(admin, id);
    await pool().query("UPDATE invoices SET amount_paid_minor = 1000 WHERE id = $1", [id]);
    await expect(cancelInvoice(admin, id, "Masquer le paiement")).rejects.toThrow(/avoir/);
  });

  it("avoir partiel puis total plafonné au montant de la facture", async () => {
    const { admin, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    await issueInvoice(admin, id);
    const cn = await createCreditNote(admin, id);
    const line = (await adminGetInvoice(admin, cn))!.items[0];
    await expect(setInvoiceLineQuantity(admin, line.id, 5)).rejects.toThrow(/dépasser/);
    await setInvoiceLineQuantity(admin, line.id, 1);
    const n = await issueInvoice(admin, cn);
    expect(n).toMatch(/^AV-\d{4}-\d{4}$/);
    expect((await adminGetInvoice(admin, id))!.invoice.credited_total_minor).toBe(150000);
    const cn2 = await createCreditNote(admin, id);
    // 4 × 1500 = 6000 alors qu'il reste 6100 − 1500 = 4600 à créditer : refus.
    await expect(issueInvoice(admin, cn2)).rejects.toThrow(/dépasserait/);
  }, 30000);

  it("facture manuelle : lignes libres, brouillon supprimable avec le droit dédié", async () => {
    const admin = await makeActor(["admin"]);
    const accountant = await makeActor(["accountant"]);
    const c = await makeCustomer();
    const customerId = (await pool().query("SELECT id FROM customers WHERE user_id = $1", [c.id])).rows[0].id;
    const id = await createManualInvoice(accountant, customerId);
    await addInvoiceLine(accountant, id, { description: "Prestation de calibration", unitLabel: "forfait", quantity: "1", unitPrice: "2500" });
    expect((await adminGetInvoice(accountant, id))!.invoice.total_minor).toBe(250000);
    await expect(deleteDraft(accountant, id)).rejects.toThrow(ForbiddenError);
    await deleteDraft(admin, id);
    expect(await adminGetInvoice(admin, id)).toBeNull();
  });

  it("droits : le gestionnaire de stock et les clients ne gèrent pas les factures", async () => {
    const { admin, c, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    await expect(createInvoiceFromOrder(await makeActor(["stock_manager"]), orderId)).rejects.toThrow(ForbiddenError);
    await expect(createInvoiceFromOrder(await makeActor(["order_manager"]), orderId)).rejects.toThrow(ForbiddenError);
    await expect(createInvoiceFromOrder(c, orderId)).rejects.toThrow(ForbiddenError);
    const id = await createInvoiceFromOrder(admin, orderId);
    await issueInvoice(admin, id);
    const other = await makeCustomer();
    expect(await getInvoiceForViewer(other, id)).toBeNull();
  });

  it("taxe incluse calculée en entiers", () => {
    expect(includedTax(116000, 1600)).toBe(16000);
    expect(includedTax(100000, 0)).toBe(0);
    expect(includedTax(999, 1600)).toBe(138); // 9,99 × 16/116 = 1,3779 → 1,38
  });

  it("génère un PDF valide avec le logo", async () => {
    const { admin, orderId } = await confirmedOrder();
    await changeOrderStatus(admin, orderId, "confirmed", null);
    const id = await createInvoiceFromOrder(admin, orderId);
    await issueInvoice(admin, id);
    const { invoice, items } = (await adminGetInvoice(admin, id))!;
    const s = await getStoreSettings();
    const pdf = await renderInvoicePdf(invoice, items, { ...s, tax_label: s.tax_label });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000); // logo intégré
    expect(pdf.includes(Buffer.from("/Subtype /Image"))).toBe(true);
  });
});
