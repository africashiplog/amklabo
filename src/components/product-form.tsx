"use client";

import { useState } from "react";
import type { ActionState } from "@/server/action";
import { t } from "@/i18n/fr";
import { ActionForm, Checkbox, Field, SubmitButton } from "./forms";
import { Button, Card, inputClass } from "./ui";

type Cat = { id: string; name: string; parent_id: string | null; is_active: boolean };
export type ProductFormValues = {
  id: string; name: string; sku: string; barcode: string | null; description: string | null; category_id: string | null;
  brand: string | null; manufacturer: string | null; sale_unit: string; units_per_sale_unit: number; retailPrice: string;
  min_order_qty: number; stock_alert_threshold: number; track_lots: boolean; is_featured: boolean; status: string;
  specs: { label: string; value: string }[];
};

export function ProductForm({ action, categories, product, canEditPrice = true }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>; categories: Cat[]; product?: ProductFormValues; canEditPrice?: boolean;
}) {
  const [specs, setSpecs] = useState(product?.specs.length ? product.specs : []);
  const top = categories.filter((c) => !c.parent_id);

  return (
    <ActionForm action={action}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Informations générales</h2>
        <Field name="name" label="Nom du produit" defaultValue={product?.name} required />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="sku" label="Référence (SKU)" defaultValue={product?.sku} required />
          <Field name="barcode" label="Code-barres" hint="(facultatif)" defaultValue={product?.barcode ?? ""} />
          <Field name="categoryId" label="Catégorie" as="select" defaultValue={product?.category_id ?? ""}>
            <option value="">— Aucune —</option>
            {top.map((c) => (
              <optgroup key={c.id} label={c.name + (c.is_active ? "" : " (inactive)")}>
                <option value={c.id}>{c.name}</option>
                {categories.filter((k) => k.parent_id === c.id).map((k) => <option key={k.id} value={k.id}>— {k.name}</option>)}
              </optgroup>
            ))}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="brand" label="Marque" hint="(si connue)" defaultValue={product?.brand ?? ""} />
          <Field name="manufacturer" label="Fabricant" hint="(si connu)" defaultValue={product?.manufacturer ?? ""} />
        </div>
        <Field name="description" label="Description" as="textarea" rows={6} defaultValue={product?.description ?? ""} />
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Vente et prix de détail</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {canEditPrice ? (
            <Field name="retailPrice" label="Prix public (MRU)" inputMode="decimal" placeholder="ex. 1250" defaultValue={product?.retailPrice ?? ""} required />
          ) : (
            <div>
              <input type="hidden" name="retailPrice" value={product?.retailPrice ?? "0"} />
              <p className="mb-1 text-sm font-medium text-slate-700">Prix public (MRU)</p>
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{product && product.retailPrice !== "0" ? product.retailPrice : "À fixer par un administrateur"}</p>
            </div>
          )}
          <Field name="saleUnit" label="Unité de vente" as="select" defaultValue={product?.sale_unit ?? "piece"}>
            {Object.entries(t.saleUnit).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <Field name="unitsPerSaleUnit" label="Unités par unité de vente" type="number" min={1} defaultValue={product?.units_per_sale_unit ?? 1} />
          <Field name="minOrderQty" label="Quantité minimale" type="number" min={1} defaultValue={product?.min_order_qty ?? 1} />
        </div>
        <p className="text-xs text-slate-500">Les paliers de quantité et tarifs de gros se gèrent dans le panneau « Tarifs dégressifs ». Tous les prix sont recalculés côté serveur.</p>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Stock</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="stockAlertThreshold" label="Seuil d'alerte de stock" type="number" min={0} defaultValue={product?.stock_alert_threshold ?? 0} />
          <div className="pt-7"><Checkbox name="trackLots" label="Suivi par lots et dates de péremption" defaultChecked={product?.track_lots} /></div>
        </div>
        <p className="text-xs text-slate-500">Les entrées, sorties et lots se gèrent dans le module Stock.</p>
      </Card>

      <Card className="space-y-3 p-6">
        <h2 className="font-semibold">Caractéristiques techniques</h2>
        <p className="text-xs text-slate-500">Uniquement des informations vérifiées (fiche fabricant, emballage…).</p>
        {specs.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <input aria-label={`Caractéristique ${i + 1}`} name="specLabel" defaultValue={s.label} placeholder="ex. Volume" className={inputClass} />
            <input aria-label={`Valeur ${i + 1}`} name="specValue" defaultValue={s.value} placeholder="ex. 5 ml" className={inputClass} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setSpecs(specs.filter((_, j) => j !== i))} aria-label="Retirer">✕</Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setSpecs([...specs, { label: "", value: "" }])}>+ Ajouter une caractéristique</Button>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Publication</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="status" label="Statut" as="select" defaultValue={product?.status ?? "draft"}>
            {Object.entries(t.productStatus)
              .filter(([k]) => canEditPrice || product || k === "draft")
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <div className="pt-7"><Checkbox name="isFeatured" label="Mettre en avant sur l'accueil" defaultChecked={product?.is_featured} /></div>
        </div>
        <p className="text-xs text-slate-500">Brouillon et Archivé : invisibles sur le site. Indisponible : visible mais signalé comme non disponible.</p>
      </Card>

      <div className="flex justify-end">
        <SubmitButton>{product ? "Enregistrer le produit" : "Créer le produit"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
