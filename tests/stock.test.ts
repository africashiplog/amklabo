import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { createProduct } from "@/server/services/catalog";
import {
  addPoItem, cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder, markPoOrdered, receivePurchaseOrder, saveSupplier,
} from "@/server/services/purchasing";
import { getAvailability, getProductStock, recordCount, recordEntry, recordExit } from "@/server/services/stock";
import { baseProduct, firstCategoryId, makeActor } from "./helpers";

async function product(trackLots = false) {
  const admin = await makeActor(["admin"]);
  const { id } = await createProduct(admin, baseProduct(await firstCategoryId(), { trackLots }));
  return { admin, id };
}

const entry = (productId: string, quantity: number, over: Record<string, unknown> = {}) => ({
  productId, type: "manual_in" as const, quantity: String(quantity), lotNumber: "", expiryDate: "", supplierId: null,
  unitCost: "", reason: "Stock initial", ...over,
});

describe("mouvements de stock", () => {
  it("entrée puis sortie : solde et historique traçables", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 20));
    await recordExit(admin, { productId: id, lotId: null, type: "loss", quantity: "3", reason: "Boîtes abîmées" });
    const s = await getProductStock(admin, id);
    expect(s!.product.on_hand).toBe(17);
    expect(s!.movements.map((m) => [m.movement_type, m.quantity, m.balance_after])).toEqual([
      ["loss", -3, 17], ["manual_in", 20, 20],
    ]);
    const audit = await pool().query("SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'stock.%' ORDER BY id", [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["stock.entry", "stock.exit"]);
  });

  it("refuse une sortie supérieure au stock (pas de stock négatif)", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 5));
    await expect(recordExit(admin, { productId: id, lotId: null, type: "adjustment_out", quantity: "6", reason: "Erreur" }))
      .rejects.toThrow(/Stock insuffisant/);
    expect((await getAvailability([id])).get(id)).toBe(5);
  });

  it("la base elle-même interdit un lot négatif", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 2));
    await expect(pool().query("UPDATE stock_lots SET qty_on_hand = -1 WHERE product_id = $1", [id])).rejects.toThrow(/check/i);
  });

  it("aucune survente lors de sorties concurrentes", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 10));
    // 6 sorties simultanées de 3 unités sur un stock de 10 : 3 seulement peuvent réussir.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => recordExit(admin, { productId: id, lotId: null, type: "adjustment_out", quantity: "3", reason: "Test concurrence" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof UserError)).toBe(true);
    expect((await getAvailability([id])).get(id)).toBe(1);
  });

  it("produit suivi par lots : lot et péremption obligatoires", async () => {
    const { admin, id } = await product(true);
    await expect(recordEntry(admin, entry(id, 5))).rejects.toThrow(/suivi par lots/);
    await recordEntry(admin, entry(id, 5, { lotNumber: "L001", expiryDate: "2030-01-31" }));
  });

  it("sortie FEFO : le lot qui périme le plus tôt sort en premier, les lots périmés sont exclus", async () => {
    const { admin, id } = await product(true);
    await recordEntry(admin, entry(id, 4, { lotNumber: "TARD", expiryDate: "2031-06-30" }));
    await recordEntry(admin, entry(id, 4, { lotNumber: "TOT", expiryDate: "2030-01-31" }));
    await recordEntry(admin, entry(id, 9, { lotNumber: "PERIME", expiryDate: "2020-01-01" }));
    expect((await getAvailability([id])).get(id)).toBe(8);
    await recordExit(admin, { productId: id, lotId: null, type: "adjustment_out", quantity: "6", reason: "Test FEFO" });
    const lots = (await getProductStock(admin, id))!.lots;
    const byNumber = Object.fromEntries(lots.map((l) => [l.lot_number, l.qty_on_hand]));
    expect(byNumber).toEqual({ TOT: 0, TARD: 2, PERIME: 9 });
    // Mise au rebut explicite du lot périmé.
    const perime = lots.find((l) => l.lot_number === "PERIME")!;
    await recordExit(admin, { productId: id, lotId: perime.id, type: "expiry_writeoff", quantity: "9", reason: "Périmé" });
  });

  it("inventaire : aligne le lot sur la quantité comptée", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 10));
    const lot = (await getProductStock(admin, id))!.lots[0];
    await recordCount(admin, { lotId: lot.id, counted: "7", reason: "Inventaire mensuel" });
    const s = (await getProductStock(admin, id))!;
    expect(s.product.on_hand).toBe(7);
    expect(s.movements[0]).toMatchObject({ movement_type: "adjustment_out", quantity: -3, balance_after: 7 });
  });

  it("l'historique des mouvements est immuable", async () => {
    const { admin, id } = await product();
    await recordEntry(admin, entry(id, 1));
    await expect(pool().query("UPDATE inventory_movements SET quantity = 99 WHERE product_id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(pool().query("DELETE FROM inventory_movements WHERE product_id = $1", [id])).rejects.toThrow(/permission denied/);
    const owner = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    try {
      await expect(owner.query("DELETE FROM inventory_movements")).rejects.toThrow(/ajout seul/);
    } finally {
      await owner.end();
    }
  });

  it("les rôles sans droit de stock ne peuvent pas modifier le stock", async () => {
    const { id } = await product();
    for (const role of ["accountant", "order_manager", "delivery", "customer_retail"] as const) {
      await expect(recordEntry(await makeActor([role]), entry(id, 1))).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("bons d'achat", () => {
  it("cycle complet : brouillon → commandé → réception partielle → reçu", async () => {
    const { admin, id } = await product(true);
    const supplierId = await saveSupplier(admin, null, { name: `Fournisseur ${Date.now()}`, isActive: true });
    const { id: poId, number } = await createPurchaseOrder(admin, { supplierId });
    expect(number).toMatch(/^BA-\d{4}-\d{4}$/);
    await expect(markPoOrdered(admin, poId)).rejects.toThrow(/au moins un produit/);
    await addPoItem(admin, poId, { productId: id, quantity: "100", unitCost: "450" });
    await markPoOrdered(admin, poId);
    await expect(addPoItem(admin, poId, { productId: id, quantity: "5" })).rejects.toThrow(/brouillon/);

    const item = (await getPurchaseOrder(admin, poId))!.items[0];
    await expect(receivePurchaseOrder(admin, poId, [{ itemId: item.id, quantity: 60, lotNumber: null, expiryDate: null }]))
      .rejects.toThrow(/suivi par lots/);
    await receivePurchaseOrder(admin, poId, [{ itemId: item.id, quantity: 60, lotNumber: "A1", expiryDate: "2030-05-31" }]);
    expect((await getPurchaseOrder(admin, poId))!.po.status).toBe("partially_received");
    await expect(receivePurchaseOrder(admin, poId, [{ itemId: item.id, quantity: 41, lotNumber: "A2", expiryDate: "2030-06-30" }]))
      .rejects.toThrow(/reste à recevoir \(40\)/);
    await receivePurchaseOrder(admin, poId, [{ itemId: item.id, quantity: 40, lotNumber: "A2", expiryDate: "2030-06-30" }]);
    const po = (await getPurchaseOrder(admin, poId))!;
    expect(po.po.status).toBe("received");
    expect(po.items[0].qty_received).toBe(100);
    expect((await getAvailability([id])).get(id)).toBe(100);
    const lots = (await getProductStock(admin, id))!.lots;
    expect(lots.every((l) => l.unit_cost_minor === 45000 && l.po_number === number)).toBe(true);
    await expect(cancelPurchaseOrder(admin, poId, "Test")).rejects.toThrow(/ne peut pas être annulé/);
  });

  it("numérotation séquentielle sans doublon en concurrence", async () => {
    const admin = await makeActor(["admin"]);
    const supplierId = await saveSupplier(admin, null, { name: `Fournisseur seq ${Date.now()}`, isActive: true });
    const numbers = await Promise.all(Array.from({ length: 8 }, () => createPurchaseOrder(admin, { supplierId })));
    expect(new Set(numbers.map((n) => n.number)).size).toBe(8);
  });

  it("le comptable voit les coûts, mais ne gère pas les achats", async () => {
    await expect(createPurchaseOrder(await makeActor(["accountant"]), { supplierId: "00000000-0000-0000-0000-000000000000" }))
      .rejects.toThrow(ForbiddenError);
  });
});
