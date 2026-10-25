import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { login, registerCustomer, MAX_REGISTRATIONS_PER_IP_PER_HOUR } from "@/server/services/accounts";
import { createCategory, createProduct } from "@/server/services/catalog";
import { saveMyAddress } from "@/server/services/customer-account";
import { createInvoiceFromOrder, issueInvoice } from "@/server/services/invoices";
import { addToCart, changeOrderStatus, placeOrder } from "@/server/services/orders";
import {
  cancellationsReport, csvMoney, parseRange, salesByCategory, salesByPeriod, salesByProduct, stockReport, toCsv, unpaidInvoicesReport,
} from "@/server/services/reports";
import { recordEntry } from "@/server/services/stock";
import { resetUserPassword } from "@/server/services/users";
import { saveZone } from "@/server/services/zones";
import { baseProduct, makeActor, makeCustomer, uniqueEmail } from "./helpers";

const today = new Date().toISOString().slice(0, 10);

async function sale(qty: number, cancel = false) {
  const admin = await makeActor(["admin"]);
  // Catégorie dédiée : aucune promotion d'un autre test ne s'y applique.
  const cat = await createCategory(admin, { name: `Rapport ${randomUUID().slice(0, 8)}`, parentId: null, isActive: true });
  const { id: productId } = await createProduct(admin, baseProduct(cat.id, { retailPrice: "100", trackLots: false }));
  await recordEntry(admin, { productId, type: "manual_in", quantity: "50", lotNumber: "", expiryDate: "", supplierId: null, unitCost: "", reason: "Init" });
  await saveZone(admin, null, { name: `Zone ${randomUUID().slice(0, 6)}`, city: "Nouakchott", fee: "0", freeThreshold: "", isActive: true });
  const zoneId = (await pool().query("SELECT id FROM delivery_zones WHERE is_active ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  const c = await makeCustomer();
  await saveMyAddress(c, null, { label: "A", recipient: "Client Rapport", phone: "+222 22 00 00 04", city: "Nouakchott", line1: "Rue 4", zoneId, isDefault: true });
  const addressId = (await pool().query("SELECT a.id FROM addresses a JOIN customers c ON c.id = a.customer_id WHERE c.user_id = $1", [c.id])).rows[0].id;
  await addToCart(c, productId, qty);
  const o = await placeOrder(c, { paymentMethodCode: "cash_on_delivery", addressId, idempotencyKey: randomUUID().replace(/-/g, "") });
  if (cancel) await changeOrderStatus(admin, o.id, "cancelled", "Test rapport");
  return { admin, productId, ...o };
}

describe("rapports", () => {
  it("ventes par période et par produit : commandes annulées exclues", async () => {
    const accountant = await makeActor(["accountant"]);
    const range = parseRange(today, today);
    const before = (await salesByPeriod(accountant, range, "day")).at(-1)!;
    const kept = await sale(3);
    const cancelled = await sale(5, true);
    const after = (await salesByPeriod(accountant, range, "day")).at(-1)!;
    expect(after.orders - before.orders).toBe(1);
    expect(after.total_minor - before.total_minor).toBe(30000);
    const products = await salesByProduct(accountant, range);
    expect(products.find((p) => p.product_id === kept.productId)).toMatchObject({ quantity: 3, revenue_minor: 30000 });
    expect(products.find((p) => p.product_id === cancelled.productId)).toBeUndefined();
    expect((await cancellationsReport(accountant, range)).cancelled.some((c) => c.number === cancelled.number)).toBe(true);
    expect((await salesByCategory(accountant, range)).length).toBeGreaterThan(0);
  });

  it("série continue de périodes, y compris sans vente", async () => {
    const rows = await salesByPeriod(await makeActor(["admin"]), parseRange("2020-01-01", "2020-03-31"), "month");
    expect(rows.map((r) => r.period)).toEqual(["2020-01-01", "2020-02-01", "2020-03-01"]);
    expect(rows.every((r) => r.orders === 0)).toBe(true);
  });

  it("impayés et soldes clients à partir des factures émises", async () => {
    const { admin, id } = await sale(2);
    await changeOrderStatus(admin, id, "confirmed", null);
    const inv = await createInvoiceFromOrder(admin, id);
    const number = await issueInvoice(admin, inv);
    const { invoices, balances } = await unpaidInvoicesReport(admin);
    const row = invoices.find((i) => i.number === number)!;
    expect(row.balance_minor).toBe(20000);
    expect(balances.find((b) => b.customer === row.customer)!.balance_minor).toBeGreaterThanOrEqual(20000);
  });

  it("le stock distingue physique, réservé et disponible", async () => {
    const { productId } = await sale(4);
    const sku = (await pool().query("SELECT sku FROM products WHERE id = $1", [productId])).rows[0].sku;
    const row = (await stockReport(await makeActor(["stock_manager"]))).find((r) => r.sku === sku)!;
    expect([row.physical, row.reserved, row.available]).toEqual([50, 4, 46]);
  });

  it("droits : ventes réservées à l'administrateur et au comptable", async () => {
    const range = parseRange();
    for (const r of ["stock_manager", "order_manager", "delivery", "customer_retail"] as const) {
      await expect(salesByPeriod(await makeActor([r]), range, "day")).rejects.toThrow(ForbiddenError);
    }
    await expect(stockReport(await makeActor(["order_manager"]))).rejects.toThrow(ForbiddenError);
  });

  it("période validée", () => {
    expect(() => parseRange("2026-02-01", "2026-01-01")).toThrow(UserError);
    expect(() => parseRange("2010-01-01", "2026-01-01")).toThrow(/3 ans/);
    expect(parseRange("x", "y").to).toBe(today);
  });
});

describe("export CSV", () => {
  it("séparateur « ; », BOM UTF-8, montants à la française", () => {
    const csv = toCsv(["Produit", "Montant"], [["Gants; nitrile \"M\"", csvMoney(125050)]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Gants; nitrile ""M""";1250,50');
  });

  it("neutralise l'injection de formules", () => {
    const csv = toCsv(["Client"], [["=HYPERLINK(\"http://x\")"], ["+1+1"], ["@SUM(A1)"], ["-2"]]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'-2");
  });
});

describe("sécurité complémentaire", () => {
  it("limite le nombre de comptes créés par adresse IP", async () => {
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < MAX_REGISTRATIONS_PER_IP_PER_HOUR; i++) {
      await registerCustomer({ fullName: "Robot Test", email: uniqueEmail("ip"), phone: "+222 22 00 00 05", password: "motdepasse-solide" }, { ip });
    }
    await expect(registerCustomer({ fullName: "Robot Test", email: uniqueEmail("ip"), phone: "+222 22 00 00 05", password: "motdepasse-solide" }, { ip }))
      .rejects.toThrow(/Trop de comptes/);
  }, 60000);

  it("réinitialisation du mot de passe par l'administrateur uniquement, sessions fermées", async () => {
    const c = await makeCustomer();
    await expect(resetUserPassword(await makeActor(["order_manager"]), c.id)).rejects.toThrow(ForbiddenError);
    const admin = await makeActor(["admin"]);
    await expect(resetUserPassword(admin, admin.id)).rejects.toThrow(UserError);
    const { token } = await login({ email: c.email, password: "motdepasse-solide" });
    const temp = await resetUserPassword(admin, c.id);
    const { getSessionActor } = await import("@/server/session");
    expect(await getSessionActor(token)).toBeNull();
    await expect(login({ email: c.email, password: "motdepasse-solide" })).rejects.toThrow();
    await login({ email: c.email, password: temp });
  });
});
