import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UnauthenticatedError, UserError } from "@/server/errors";
import {
  createCategory, createProduct, deleteCategory, deleteProduct, getPublicProduct, searchPublicProducts, updateProduct,
} from "@/server/services/catalog";
import { baseProduct, firstCategoryId, makeActor, makeCustomer } from "./helpers";

describe("autorisations du catalogue (vérifiées côté serveur)", () => {
  it("refuse les visiteurs, clients, comptables et livreurs", async () => {
    const input = { name: "Catégorie interdite", parentId: null, isActive: true };
    await expect(createCategory(null, input)).rejects.toThrow(UnauthenticatedError);
    await expect(createCategory(await makeCustomer(), input)).rejects.toThrow(ForbiddenError);
    await expect(createCategory(await makeActor(["accountant"]), input)).rejects.toThrow(ForbiddenError);
    await expect(createProduct(await makeActor(["delivery"]), baseProduct(null))).rejects.toThrow(ForbiddenError);
  });

  it("autorise le gestionnaire de stock", async () => {
    const cat = await createCategory(await makeActor(["stock_manager"]), { name: "Catégorie stock", parentId: null, isActive: true });
    expect(cat.slug).toBe("categorie-stock");
  });
});

describe("catégories", () => {
  it("empêche la suppression d'une catégorie contenant des produits", async () => {
    const admin = await makeActor(["admin"]);
    const cat = await createCategory(admin, { name: "Catégorie pleine", parentId: null, isActive: true });
    await createProduct(admin, baseProduct(cat.id));
    await expect(deleteCategory(admin, cat.id)).rejects.toThrow(/Suppression impossible/);
  });

  it("supprime une catégorie vide et journalise l'opération", async () => {
    const admin = await makeActor(["admin"]);
    const cat = await createCategory(admin, { name: "Catégorie vide", parentId: null, isActive: true });
    await deleteCategory(admin, cat.id);
    const { rows } = await pool().query("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id", [cat.id]);
    expect(rows.map((r) => r.action)).toEqual(["category.create", "category.delete"]);
  });

  it("limite la hiérarchie à deux niveaux", async () => {
    const admin = await makeActor(["admin"]);
    const a = await createCategory(admin, { name: "Niveau 1", parentId: null, isActive: true });
    const b = await createCategory(admin, { name: "Niveau 2", parentId: a.id, isActive: true });
    await expect(createCategory(admin, { name: "Niveau 3", parentId: b.id, isActive: true })).rejects.toThrow(UserError);
  });
});

describe("produits", () => {
  it("stocke le prix en unités mineures et refuse un SKU en double", async () => {
    const admin = await makeActor(["admin"]);
    const input = baseProduct(await firstCategoryId());
    const { id } = await createProduct(admin, input);
    const { rows } = await pool().query("SELECT retail_price_minor FROM products WHERE id = $1", [id]);
    expect(rows[0].retail_price_minor).toBe(125050);
    await expect(createProduct(admin, { ...input, name: "Autre", sku: input.sku.toLowerCase() })).rejects.toThrow(/SKU/);
  });

  it("refuse la publication sans prix ou sans catégorie", async () => {
    const admin = await makeActor(["admin"]);
    await expect(createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: "0" }))).rejects.toThrow();
    await expect(createProduct(admin, baseProduct(null))).rejects.toThrow();
    await expect(createProduct(admin, baseProduct(await firstCategoryId(), { retailPrice: "12,345" }))).rejects.toThrow();
  });

  it("n'expose pas les brouillons ni les archives sur le site public", async () => {
    const admin = await makeActor(["admin"]);
    const draft = baseProduct(await firstCategoryId(), { status: "draft" });
    await createProduct(admin, draft);
    const res = await searchPublicProducts({ q: draft.sku });
    expect(res.total).toBe(0);
  });

  it("retrouve un produit publié par sa référence", async () => {
    const admin = await makeActor(["admin"]);
    const input = baseProduct(await firstCategoryId());
    await createProduct(admin, input);
    const res = await searchPublicProducts({ q: input.sku });
    expect(res.items.map((p) => p.sku)).toEqual([input.sku]);
    expect(await getPublicProduct(res.items[0].slug)).not.toBeNull();
  });

  it("journalise séparément les changements de prix", async () => {
    const admin = await makeActor(["admin"]);
    const input = baseProduct(await firstCategoryId());
    const { id } = await createProduct(admin, input);
    await updateProduct(admin, id, { ...input, retailPrice: "1300" });
    const { rows } = await pool().query(
      "SELECT before_data, after_data, actor_id FROM audit_logs WHERE entity_id = $1 AND action = 'product.price_change'", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].before_data).toEqual({ retail_price_minor: 125050 });
    expect(rows[0].after_data).toEqual({ retail_price_minor: 130000 });
    expect(rows[0].actor_id).toBe(admin.id);
  });

  it("refuse de supprimer un produit publié", async () => {
    const admin = await makeActor(["admin"]);
    const { id } = await createProduct(admin, baseProduct(await firstCategoryId()));
    await expect(deleteProduct(admin, id)).rejects.toThrow(/Archivez/);
  });

  it("supprime un produit archivé", async () => {
    const admin = await makeActor(["admin"]);
    const { id } = await createProduct(admin, baseProduct(await firstCategoryId(), { status: "archived" }));
    await deleteProduct(admin, id);
    expect((await pool().query("SELECT 1 FROM products WHERE id = $1", [id])).rowCount).toBe(0);
  });

  it("résiste à l'injection SQL dans la recherche", async () => {
    const res = await searchPublicProducts({ q: "'; DROP TABLE products; --", sort: "name" });
    expect(res.total).toBe(0);
    expect((await pool().query("SELECT count(*) FROM products")).rowCount).toBe(1);
  });
});
