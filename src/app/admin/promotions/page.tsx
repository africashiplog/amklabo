import { ActionForm, Checkbox, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { ProductSelect } from "@/components/product-select";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatMRU, minorToInput } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { adminListCategories, listProductOptions } from "@/server/services/catalog";
import { adminListPromotions, type PromotionRow } from "@/server/services/pricing";
import { deletePromotionAction, savePromotionAction } from "../pricing-actions";

const AUDIENCE = { all: "Tous les clients", retail: "Particuliers uniquement", business: "Professionnels uniquement" } as const;
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
// ends_at est exclusif (lendemain 00:00) : on affiche le dernier jour inclus.
const lastDay = (d: Date) => new Date(new Date(d).getTime() - 86_400_000).toISOString().slice(0, 10);

function discountLabel(p: PromotionRow) {
  return p.discount_type === "percent" ? `−${minorToInput(p.discount_value)} %` : `−${formatMRU(p.discount_value)} / unité`;
}

function PromotionForm({ promo, products, categories }: {
  promo?: PromotionRow; products: { id: string; name: string; sku: string }[]; categories: { id: string; name: string; parent_id: string | null }[];
}) {
  return (
    <ActionForm action={savePromotionAction} resetOnSuccess={!promo}>
      {promo && <input type="hidden" name="id" value={promo.id} />}
      <Field name="name" label="Nom de la promotion" defaultValue={promo?.name} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="target" label="S'applique à" as="select" defaultValue={promo?.category_id ? "category" : "product"}>
          <option value="product">Un produit</option><option value="category">Une catégorie (et ses sous-catégories)</option>
        </Field>
        <Field name="audience" label="Clients concernés" as="select" defaultValue={promo?.audience ?? "all"}>
          {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Field>
      </div>
      <ProductSelect products={products} label="Produit (si « un produit »)" defaultValue={promo?.product_id} />
      <Field name="categoryId" label="Catégorie (si « une catégorie »)" as="select" defaultValue={promo?.category_id ?? ""}>
        <option value="">—</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "— " : ""}{c.name}</option>)}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="discountType" label="Type de remise" as="select" defaultValue={promo?.discount_type ?? "percent"}>
          <option value="percent">Pourcentage</option><option value="amount">Montant par unité (MRU)</option>
        </Field>
        <Field name="discountValue" label="Valeur" inputMode="decimal" placeholder="ex. 10 ou 12,5" defaultValue={promo ? minorToInput(promo.discount_value) : ""} required />
        <Field name="startsAt" label="Du" type="date" defaultValue={promo ? day(promo.starts_at) : ""} required />
        <Field name="endsAt" label="Au (inclus)" type="date" defaultValue={promo ? lastDay(promo.ends_at) : ""} required />
      </div>
      <Checkbox name="isActive" label="Active" defaultChecked={promo?.is_active ?? true} />
      <SubmitButton size="sm">{promo ? "Enregistrer" : "Créer la promotion"}</SubmitButton>
    </ActionForm>
  );
}

export default async function PromotionsPage() {
  const actor = await requirePermissionPage("pricing.manage");
  const [promos, products, categories] = await Promise.all([adminListPromotions(actor), listProductOptions(actor), adminListCategories(actor)]);
  const now = Date.now();
  return (
    <>
      <PageHeader title="Promotions"
        description="Une promotion s'applique au prix public. Le client paie toujours le meilleur prix auquel il a droit (prix public, palier ou promotion), sans cumul. Un prix négocié reste prioritaire." />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          {promos.length === 0 && <Card className="p-6 text-sm text-slate-600">Aucune promotion.</Card>}
          {promos.map((p) => {
            const running = p.is_active && new Date(p.starts_at).getTime() <= now && new Date(p.ends_at).getTime() > now;
            return (
              <Card key={p.id} className="p-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{p.name}</span>{" "}
                      {running ? <Badge tone="green">En cours</Badge> : p.is_active ? <Badge tone="amber">Programmée / terminée</Badge> : <Badge>Inactive</Badge>}
                      <span className="block text-sm text-slate-600">
                        {discountLabel(p)} · {p.product_name ?? `Catégorie ${p.category_name}`} · {AUDIENCE[p.audience]} · du {day(p.starts_at)} au {lastDay(p.ends_at)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-brand-700">Modifier</span>
                  </summary>
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <PromotionForm promo={p} products={products} categories={categories} />
                    <ConfirmAction action={deletePromotionAction} fields={{ id: p.id }} label="Supprimer"
                      title={`Supprimer « ${p.name} » ?`} confirmLabel="Supprimer"
                      description="La promotion cessera immédiatement de s'appliquer. Préférez la désactiver pour en garder la trace dans la liste." />
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">Nouvelle promotion</h2>
          <PromotionForm products={products} categories={categories} />
        </Card>
      </div>
    </>
  );
}
