"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formOptional, formString, runAction, type ActionState } from "@/server/action";
import { getActor } from "@/server/current";
import { UserError } from "@/server/errors";
import {
  addProductImage, createCategory, createProduct, deleteCategory, deleteProduct, deleteProductImage,
  makeCoverImage, moveCategory, updateCategory, updateProduct, type ProductInput,
} from "@/server/services/catalog";
import { markMessageHandled } from "@/server/services/contact";
import { replaceLogo, resetLogo, updateContentPage, updateStoreSettings } from "@/server/services/settings";
import { createStaffUser, setStaffRoles, setUserStatus } from "@/server/services/users";
import { saveZone } from "@/server/services/zones";

const refreshSite = () => revalidatePath("/", "layout");

// --- Catégories -------------------------------------------------------------
function categoryInput(fd: FormData) {
  return {
    name: formString(fd, "name"),
    description: formString(fd, "description"),
    parentId: formOptional(fd, "parentId"),
    isActive: fd.get("isActive") === "on",
  };
}

export async function saveCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = formOptional(fd, "id");
  const state = await runAction(async () => {
    const actor = await getActor();
    if (id) await updateCategory(actor, id, categoryInput(fd));
    else await createCategory(actor, categoryInput(fd));
    refreshSite();
    return id ? "Catégorie mise à jour." : "Catégorie créée.";
  });
  if (state.ok && id) redirect("/admin/categories");
  return state;
}

export async function moveCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await moveCategory(await getActor(), formString(fd, "id"), formString(fd, "direction") === "up" ? "up" : "down");
    refreshSite();
  });
}

export async function deleteCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteCategory(await getActor(), formString(fd, "id"));
    refreshSite();
    return "Catégorie supprimée.";
  });
}

// --- Produits ---------------------------------------------------------------
function productInput(fd: FormData): ProductInput {
  const labels = fd.getAll("specLabel").map(String);
  const values = fd.getAll("specValue").map(String);
  return {
    name: formString(fd, "name"),
    sku: formString(fd, "sku"),
    barcode: formString(fd, "barcode"),
    description: formString(fd, "description"),
    categoryId: formOptional(fd, "categoryId"),
    brand: formString(fd, "brand"),
    manufacturer: formString(fd, "manufacturer"),
    saleUnit: formString(fd, "saleUnit") as ProductInput["saleUnit"],
    unitsPerSaleUnit: formString(fd, "unitsPerSaleUnit") || "1",
    retailPrice: formString(fd, "retailPrice"),
    minOrderQty: formString(fd, "minOrderQty") || "1",
    stockAlertThreshold: formString(fd, "stockAlertThreshold") || "0",
    trackLots: fd.get("trackLots") === "on",
    isFeatured: fd.get("isFeatured") === "on",
    status: formString(fd, "status") as ProductInput["status"],
    specs: labels.map((label, i) => ({ label, value: values[i] ?? "" })),
  };
}

export async function createProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await runAction(async () => {
    const row = await createProduct(await getActor(), productInput(fd));
    id = row.id;
    refreshSite();
  });
  if (state.ok) redirect(`/admin/produits/${id}?cree=1`);
  return state;
}

export async function updateProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateProduct(await getActor(), formString(fd, "id"), productInput(fd));
    refreshSite();
    return "Produit enregistré.";
  });
}

export async function deleteProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    await deleteProduct(await getActor(), formString(fd, "id"));
    refreshSite();
  });
  if (state.ok) redirect("/admin/produits?supprime=1");
  return state;
}

export async function uploadProductImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choisissez une image.");
    await addProductImage(await getActor(), formString(fd, "productId"), file, formOptional(fd, "alt"));
    refreshSite();
    return "Image ajoutée.";
  });
}

export async function deleteProductImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await deleteProductImage(await getActor(), formString(fd, "imageId"));
    refreshSite();
    return "Image supprimée.";
  });
}

export async function coverImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await makeCoverImage(await getActor(), formString(fd, "imageId"));
    refreshSite();
  });
}

// --- Paramètres -------------------------------------------------------------
export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateStoreSettings(await getActor(), {
      storeName: formString(fd, "storeName"), tagline: formString(fd, "tagline"), email: formString(fd, "email"),
      phone: formString(fd, "phone"), whatsapp: formString(fd, "whatsapp"), addressLine: formString(fd, "addressLine"),
      city: formString(fd, "city"), openingHours: formString(fd, "openingHours"), legalName: formString(fd, "legalName"),
      taxId: formString(fd, "taxId"), tradeRegister: formString(fd, "tradeRegister"),
      bankDetails: formString(fd, "bankDetails"), invoiceFooter: formString(fd, "invoiceFooter"),
      expiryAlertDays: formString(fd, "expiryAlertDays") || "90",
      taxRate: formString(fd, "taxRate"), taxLabel: formString(fd, "taxLabel") || "TVA",
      invoiceDueDays: formString(fd, "invoiceDueDays") || "0", returnWindowDays: formString(fd, "returnWindowDays") || "0",
    });
    refreshSite();
    return "Paramètres enregistrés.";
  });
}

export async function uploadLogoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choisissez un fichier.");
    await replaceLogo(await getActor(), file);
    refreshSite();
    return "Logo remplacé.";
  });
}

export async function resetLogoAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await resetLogo(await getActor());
    refreshSite();
    return "Logo officiel d'origine rétabli.";
  });
}

export async function saveContentPageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const slug = formString(fd, "slug");
    await updateContentPage(await getActor(), slug, { title: formString(fd, "title"), body: formString(fd, "body") });
    refreshSite();
    return "Page enregistrée.";
  });
}

export async function saveZoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await saveZone(await getActor(), formOptional(fd, "id"), {
      name: formString(fd, "name"), city: formString(fd, "city"), fee: formString(fd, "fee"),
      freeThreshold: formString(fd, "freeThreshold"), isActive: fd.get("isActive") === "on",
    });
    refreshSite();
    return "Zone enregistrée.";
  });
}

// --- Utilisateurs -----------------------------------------------------------
export async function setRolesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setStaffRoles(await getActor(), formString(fd, "userId"), fd.getAll("roles").map(String));
    revalidatePath("/admin/utilisateurs");
    return "Rôles mis à jour.";
  });
}

export async function setUserStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const status = formString(fd, "status") === "suspended" ? "suspended" : "active";
    await setUserStatus(await getActor(), formString(fd, "userId"), status);
    revalidatePath("/admin/utilisateurs");
    return status === "suspended" ? "Compte suspendu." : "Compte réactivé.";
  });
}

export async function createStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const res = await createStaffUser(await getActor(), {
      fullName: formString(fd, "fullName"), email: formString(fd, "email"), phone: formString(fd, "phone"),
      roles: fd.getAll("roles").map(String) as never,
    });
    revalidatePath("/admin/utilisateurs");
    return `Compte créé. Mot de passe temporaire (affiché une seule fois, à transmettre de façon sûre) : ${res.tempPassword}`;
  });
}

// --- Messages ---------------------------------------------------------------
export async function markHandledAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await markMessageHandled(await getActor(), formString(fd, "id"));
    revalidatePath("/admin/messages");
    return "Message marqué comme traité.";
  });
}
