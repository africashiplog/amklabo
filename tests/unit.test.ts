import { describe, expect, it } from "vitest";
import { formatMRU, minorToInput, parseMRU } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { can, permissionsFor } from "@/server/permissions";
import { detectImageType, resolveStoragePath } from "@/server/storage";

describe("montants MRU", () => {
  it("convertit les saisies en unités mineures sans flottants", () => {
    expect(parseMRU("1250")).toBe(125000);
    expect(parseMRU("1 250,50")).toBe(125050);
    expect(parseMRU("0.1")).toBe(10);
    expect(parseMRU("19,99")).toBe(1999);
  });
  it("refuse les saisies ambiguës ou invalides", () => {
    for (const bad of ["", "abc", "-5", "1,234", "12.345", "1e3"]) expect(parseMRU(bad)).toBeNull();
  });
  it("formate en MRU", () => {
    expect(formatMRU(125050)).toBe("1 250,50 MRU");
    expect(formatMRU(100000000)).toBe("1 000 000 MRU");
    expect(minorToInput(125050)).toBe("1250,50");
    expect(minorToInput(125000)).toBe("1250");
  });
});

describe("slugs", () => {
  it("supprime accents et caractères spéciaux", () => {
    expect(slugify("Pansements, compresses & consommables")).toBe("pansements-compresses-et-consommables");
    expect(slugify("Équipements médicaux")).toBe("equipements-medicaux");
  });
});

describe("matrice des permissions", () => {
  it("les clients n'ont aucun accès à l'administration", () => {
    expect(permissionsFor(["customer_retail"]).size).toBe(0);
    expect(can(["customer_business"], "admin.access")).toBe(false);
  });
  it("applique le moindre privilège au personnel", () => {
    expect(can(["stock_manager"], "catalog.manage")).toBe(true);
    expect(can(["stock_manager"], "users.manage")).toBe(false);
    expect(can(["stock_manager"], "settings.manage")).toBe(false);
    expect(can(["accountant"], "users.manage")).toBe(false);
    expect(can(["accountant"], "catalog.manage")).toBe(false);
    expect(can(["delivery"], "customers.read")).toBe(false);
    expect(can(["delivery"], "dashboard.view")).toBe(false);
    expect(can(["admin"], "users.manage")).toBe(true);
  });
});

describe("stockage", () => {
  it("valide le type d'image par signature binaire", () => {
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(detectImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
  it("empêche la sortie du répertoire de stockage", () => {
    expect(resolveStoragePath("../../etc/passwd")).toBeNull();
    expect(resolveStoragePath("products/../../x.png")).toBeNull();
    expect(resolveStoragePath("products/00000000-0000-0000-0000-000000000000.png")).not.toBeNull();
  });
});
