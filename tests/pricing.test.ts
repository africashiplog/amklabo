import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { createCategory, createProduct, updateProduct } from "@/server/services/catalog";
import { reviewBusinessAccount, submitBusinessRequest } from "@/server/services/business";
import {
  addTier, applyDiscount, getPriceContext, listVisibleTiers, quote, quoteLines, savePromotion, setCustomerPrice,
} from "@/server/services/pricing";
import { baseProduct, firstCategoryId, makeActor, makeCustomer } from "./helpers";

const request = {
  establishmentName: "Laboratoire Test", activity: "laboratory" as const, contactName: "Dr Test",
  phone: "+222 22 44 55 66", email: "", addressLine: "Rue 42", city: "Nouakchott", professionalId: "", message: "",
};

/** Produit à 1 000 MRU avec paliers : tous dès 10 → 950 ; pros dès 10 → 900, dès 50 → 800. */
async function setup() {
  const admin = await makeActor(["admin"]);
  const { id } = await createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: "1000" }));
  await addTier(admin, id, { audience: "all", minQty: "10", unitPrice: "950" });
  await addTier(admin, id, { audience: "business", minQty: "10", unitPrice: "900" });
  await addTier(admin, id, { audience: "business", minQty: "50", unitPrice: "800" });
  return { admin, productId: id };
}

async function approvedPro(admin: Awaited<ReturnType<typeof makeActor>>) {
  const pro = await makeCustomer();
  await submitBusinessRequest(pro, request);
  const { rows } = await pool().query(
    "SELECT b.id FROM business_accounts b JOIN customers c ON c.id = b.customer_id WHERE c.user_id = $1", [pro.id]);
  await reviewBusinessAccount(admin, rows[0].id, "approve", null);
  return { pro, businessId: rows[0].id as string };
}

describe("remises (arithmétique entière)", () => {
  it("arrondit les pourcentages au centime, demi au supérieur", () => {
    expect(applyDiscount(100000, "percent", 1000)).toBe(90000); // 10 %
    expect(applyDiscount(999, "percent", 1250)).toBe(874);      // 12,5 % de 9,99 = 1,24875 → 1,25
    expect(applyDiscount(500, "amount", 800)).toBe(0);
  });
});

describe("moteur de tarification", () => {
  it("visiteur et particulier : prix public, puis palier « tous »", async () => {
    const { productId } = await setup();
    const retail = await getPriceContext(await makeCustomer());
    expect((await quote(retail, productId, 1)).unitPriceMinor).toBe(100000);
    expect((await quote(retail, productId, 9)).source).toBe("retail");
    const q10 = await quote(retail, productId, 10);
    expect([q10.unitPriceMinor, q10.source, q10.lineTotalMinor]).toEqual([95000, "tier", 950000]);
    // Jamais de tarif professionnel pour un particulier, même en grande quantité.
    expect((await quote(retail, productId, 100)).unitPriceMinor).toBe(95000);
  });

  it("un compte professionnel en attente n'a pas accès aux tarifs de gros", async () => {
    const { productId } = await setup();
    const pending = await makeCustomer();
    await submitBusinessRequest(pending, request);
    const ctx = await getPriceContext(pending);
    expect(ctx.isBusiness).toBe(false);
    expect((await quote(ctx, productId, 60)).unitPriceMinor).toBe(95000);
    expect((await listVisibleTiers(ctx, productId)).some((t) => t.kind === "business_tier")).toBe(false);
  });

  it("un professionnel approuvé bénéficie des paliers selon la quantité", async () => {
    const { admin, productId } = await setup();
    const { pro } = await approvedPro(admin);
    const ctx = await getPriceContext(pro);
    expect(ctx.isBusiness).toBe(true);
    const [q1, q10, q49, q50] = await quoteLines(ctx, [1, 10, 49, 50].map((n) => ({ productId, quantity: n })));
    expect([q1.unitPriceMinor, q10.unitPriceMinor, q49.unitPriceMinor, q50.unitPriceMinor]).toEqual([100000, 90000, 90000, 80000]);
    expect(q50.source).toBe("business_tier");
  });

  it("la suspension du compte pro retire immédiatement les tarifs de gros", async () => {
    const { admin, productId } = await setup();
    const { pro, businessId } = await approvedPro(admin);
    await reviewBusinessAccount(admin, businessId, "suspend", "Impayés");
    expect((await quote(await getPriceContext(pro), productId, 50)).unitPriceMinor).toBe(95000);
  });

  it("le prix négocié prime sur tout, y compris une promotion plus avantageuse", async () => {
    const { admin, productId } = await setup();
    const { pro, rows } = await (async () => {
      const r = await approvedPro(admin);
      const q = await pool().query("SELECT id FROM customers WHERE user_id = $1", [r.pro.id]);
      return { pro: r.pro, rows: q.rows };
    })();
    await setCustomerPrice(admin, rows[0].id, { productId, minQty: "1", unitPrice: "850" });
    const today = new Date().toISOString().slice(0, 10);
    await savePromotion(admin, null, {
      name: "Promo 50 %", target: "product", productId, categoryId: null, audience: "all",
      discountType: "percent", discountValue: "50", startsAt: today, endsAt: today, isActive: true,
    });
    const q = await quote(await getPriceContext(pro), productId, 1);
    expect([q.unitPriceMinor, q.source]).toEqual([85000, "customer"]);
  });

  it("promotion : meilleur prix sans cumul, respect de l'audience et des dates", async () => {
    const { admin, productId } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await savePromotion(admin, null, {
      name: "Promo particuliers -8 %", target: "product", productId, categoryId: null, audience: "retail",
      discountType: "percent", discountValue: "8", startsAt: today, endsAt: today, isActive: true,
    });
    const retail = await getPriceContext(await makeCustomer());
    const q1 = await quote(retail, productId, 1);
    expect([q1.unitPriceMinor, q1.source]).toEqual([92000, "promotion"]);
    // 10 unités : palier 950 vs promo 920 → promo (meilleur prix), pas de cumul (920 et non 874).
    expect((await quote(retail, productId, 10)).unitPriceMinor).toBe(92000);
    // Promotion réservée aux particuliers : un pro approuvé ne l'obtient pas.
    const { pro } = await approvedPro(admin);
    expect((await quote(await getPriceContext(pro), productId, 1)).unitPriceMinor).toBe(100000);
    // Hors période : non appliquée.
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect((await quote(retail, productId, 1, later)).unitPriceMinor).toBe(100000);
  });

  it("promotion de catégorie appliquée aux produits de la catégorie", async () => {
    const admin = await makeActor(["admin"]);
    // Catégorie dédiée : la promotion ne doit pas affecter les produits des autres tests.
    const cat = (await createCategory(admin, { name: `Promo ${Date.now()}`, parentId: null, isActive: true })).id;
    const { id } = await createProduct(admin, baseProduct(cat, { retailPrice: "200" }));
    const today = new Date().toISOString().slice(0, 10);
    await savePromotion(admin, null, {
      name: "Remise catégorie", target: "category", productId: null, categoryId: cat, audience: "all",
      discountType: "amount", discountValue: "15", startsAt: today, endsAt: today, isActive: true,
    });
    expect((await quote(await getPriceContext(null), id, 1)).unitPriceMinor).toBe(18500);
  });

  it("refuse les quantités invalides", async () => {
    const { productId } = await setup();
    for (const n of [0, -1, 1.5, 2_000_000]) await expect(quote(await getPriceContext(null), productId, n)).rejects.toThrow(UserError);
  });
});

describe("administration des prix", () => {
  it("seul un administrateur gère les paliers, prix négociés et promotions", async () => {
    const { productId } = await setup();
    const sm = await makeActor(["stock_manager"]);
    await expect(addTier(sm, productId, { audience: "all", minQty: "20", unitPrice: "900" })).rejects.toThrow(ForbiddenError);
    await expect(addTier(await makeActor(["accountant"]), productId, { audience: "all", minQty: "20", unitPrice: "900" })).rejects.toThrow(ForbiddenError);
  });

  it("le gestionnaire de stock ne peut ni fixer ni modifier un prix", async () => {
    const admin = await makeActor(["admin"]);
    const sm = await makeActor(["stock_manager"]);
    const cat = await firstCategoryId();
    await expect(createProduct(sm, baseProduct(cat))).rejects.toThrow(/administrateur/);
    const draft = await createProduct(sm, baseProduct(cat, { status: "draft", retailPrice: "5000" }));
    const { rows } = await pool().query("SELECT retail_price_minor FROM products WHERE id = $1", [draft.id]);
    expect(rows[0].retail_price_minor).toBe(0);
    const input = baseProduct(cat, { retailPrice: "100" });
    const { id } = await createProduct(admin, input);
    await expect(updateProduct(sm, id, { ...input, retailPrice: "1" })).rejects.toThrow(ForbiddenError);
    await updateProduct(sm, id, { ...input, description: "Mise à jour autorisée" });
  });

  it("refuse un palier supérieur au prix public ou en double", async () => {
    const { admin, productId } = await setup();
    await expect(addTier(admin, productId, { audience: "all", minQty: "20", unitPrice: "1000" })).rejects.toThrow(/inférieur/);
    await expect(addTier(admin, productId, { audience: "business", minQty: "10", unitPrice: "850" })).rejects.toThrow(/existe déjà/);
  });

  it("prix négocié réservé aux clients professionnels", async () => {
    const { admin, productId } = await setup();
    const c = await makeCustomer();
    const { rows } = await pool().query("SELECT id FROM customers WHERE user_id = $1", [c.id]);
    await expect(setCustomerPrice(admin, rows[0].id, { productId, minQty: "1", unitPrice: "500" })).rejects.toThrow(/professionnels/);
  });

  it("journalise les modifications de tarifs", async () => {
    const { productId } = await setup();
    const { rows } = await pool().query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND action = 'pricing.tier_add'", [productId]);
    expect(rows[0].n).toBe(3);
  });
});

describe("comptes professionnels", () => {
  it("workflow : demande → refus motivé → nouvelle demande → approbation", async () => {
    const admin = await makeActor(["admin"]);
    const c = await makeCustomer();
    await submitBusinessRequest(c, request);
    await expect(submitBusinessRequest(c, request)).rejects.toThrow(/en cours/);
    const { rows } = await pool().query("SELECT b.id FROM business_accounts b JOIN customers c ON c.id = b.customer_id WHERE c.user_id = $1", [c.id]);
    await expect(reviewBusinessAccount(admin, rows[0].id, "reject", "")).rejects.toThrow(/motif/);
    await reviewBusinessAccount(admin, rows[0].id, "reject", "Justificatif manquant");
    await submitBusinessRequest(c, { ...request, professionalId: "NIF-123" });
    await reviewBusinessAccount(admin, rows[0].id, "approve", null);
    const roles = await pool().query("SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role", [c.id]);
    expect(roles.rows.map((r) => r.role).sort()).toEqual(["customer_business", "customer_retail"]);
    await expect(reviewBusinessAccount(admin, rows[0].id, "approve", null)).rejects.toThrow(/pas possible/);
  });

  it("seul l'administrateur approuve les comptes professionnels", async () => {
    const c = await makeCustomer();
    await submitBusinessRequest(c, request);
    const { rows } = await pool().query("SELECT b.id FROM business_accounts b JOIN customers c ON c.id = b.customer_id WHERE c.user_id = $1", [c.id]);
    await expect(reviewBusinessAccount(await makeActor(["order_manager"]), rows[0].id, "approve", null)).rejects.toThrow(ForbiddenError);
    await expect(reviewBusinessAccount(c, rows[0].id, "approve", null)).rejects.toThrow(ForbiddenError);
  });
});
