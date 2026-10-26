import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmAction, Field, InlineAction, SubmitButton } from "@/components/forms";
import { ProductForm } from "@/components/product-form";
import { Alert, Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { minorToInput } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { adminGetProduct, adminListCategories, MAX_IMAGES_PER_PRODUCT } from "@/server/services/catalog";
import { adminListTiers } from "@/server/services/pricing";
import { formatMRU } from "@/lib/money";
import { addTierAction, deleteTierAction } from "../../pricing-actions";
import { mediaUrl } from "@/server/storage";
import {
  coverImageAction, deleteProductAction, deleteProductImageAction, updateProductAction, uploadProductImageAction,
} from "../../actions";

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cree?: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("catalog.manage");
  const [data, categories, sp] = await Promise.all([adminGetProduct(actor, id), adminListCategories(actor), searchParams]);
  if (!data) notFound();
  const { product: p, images } = data;
  const deletable = p.status === "draft" || p.status === "archived";
  const canPrice = can(actor.roles, "pricing.manage");
  const tiers = await adminListTiers(actor, p.id);

  return (
    <>
      <Link href="/admin/produits" className="text-sm text-brand-700 hover:underline">← Produits</Link>
      <PageHeader title={p.name} description={<>SKU <span className="font-mono">{p.sku}</span></>}
        actions={<>
          {can(actor.roles, "stock.manage") && <LinkButton href={`/admin/stock/${p.id}`} variant="secondary">Stock et lots</LinkButton>}
          {(p.status === "published" || p.status === "unavailable") && <LinkButton href={`/produits/${p.slug}`} variant="secondary" target="_blank">Voir sur le site</LinkButton>}
        </>} />
      {sp.cree && <div className="mb-4"><Alert tone="success">Produit créé. Vous pouvez maintenant ajouter des images.</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <ProductForm action={updateProductAction} categories={categories}
          product={{ ...p, retailPrice: minorToInput(p.retail_price_minor) }} canEditPrice={canPrice} />

        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Tarifs dégressifs</h2>
            <p className="text-xs text-slate-500">Prix public : {formatMRU(p.retail_price_minor)}. « Tous » : remise quantité pour tous ; « Pros » : comptes professionnels approuvés uniquement.</p>
            {tiers.length === 0 ? <p className="text-sm text-slate-600">Aucun palier.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {tiers.map((tr) => (
                  <li key={tr.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <Badge tone={tr.audience === "business" ? "blue" : "green"}>{tr.audience === "business" ? "Pros" : "Tous"}</Badge>{" "}
                      dès {tr.min_qty} : <strong>{formatMRU(tr.unit_price_minor)}</strong>
                      {(tr.valid_from || tr.valid_to) && <span className="block text-xs text-slate-500">{tr.valid_from ?? "…"} → {tr.valid_to ?? "…"}</span>}
                    </span>
                    {canPrice && <ConfirmAction action={deleteTierAction} fields={{ tierId: tr.id }} label="✕"
                      title="Supprimer ce palier ?" description={`Palier dès ${tr.min_qty} unités à ${formatMRU(tr.unit_price_minor)}.`} confirmLabel="Supprimer" />}
                  </li>
                ))}
              </ul>
            )}
            {canPrice && (
              <ActionForm action={addTierAction} resetOnSuccess>
                <input type="hidden" name="productId" value={p.id} />
                <div className="grid grid-cols-2 gap-2">
                  <Field name="audience" label="Pour" as="select" defaultValue="business">
                    <option value="business">Pros</option><option value="all">Tous</option>
                  </Field>
                  <Field name="minQty" label="Dès (qté)" type="number" min={2} required />
                  <Field name="unitPrice" label="Prix unitaire" inputMode="decimal" required className="col-span-2" />
                  <Field name="validFrom" label="Du" type="date" />
                  <Field name="validTo" label="Au" type="date" />
                </div>
                <SubmitButton size="sm" variant="secondary">Ajouter le palier</SubmitButton>
              </ActionForm>
            )}
            {!canPrice && <p className="text-xs text-slate-500">Seul un administrateur peut modifier les prix.</p>}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Images ({images.length}/{MAX_IMAGES_PER_PRODUCT})</h2>
            {images.length > 0 && (
              <ul className="grid grid-cols-2 gap-3">
                {images.map((img, i) => (
                  <li key={img.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(img.storage_path)} alt={img.alt ?? ""} className="aspect-square w-full rounded-lg border border-slate-200 bg-white object-contain" />
                    {img.is_illustration && <p className="text-xs font-medium text-amber-700">Illustration générée — à remplacer par une vraie photo</p>}
                    {i === 0 ? <p className="text-xs font-medium text-leaf-700">Image principale</p>
                      : <InlineAction action={coverImageAction} fields={{ imageId: img.id }}>Principale</InlineAction>}
                    <ConfirmAction action={deleteProductImageAction} fields={{ imageId: img.id }} label="Supprimer"
                      title="Supprimer cette image ?" description="L'image sera définitivement supprimée du produit et du stockage." confirmLabel="Supprimer" />
                  </li>
                ))}
              </ul>
            )}
            {images.length < MAX_IMAGES_PER_PRODUCT && (
              <ActionForm action={uploadProductImageAction} resetOnSuccess>
                <input type="hidden" name="productId" value={p.id} />
                <Field name="image" label="Ajouter une image" hint="(PNG, JPEG ou WebP, 5 Mo max)" type="file" accept="image/png,image/jpeg,image/webp" required />
                <Field name="alt" label="Texte alternatif" hint="(facultatif)" />
                <SubmitButton variant="secondary" pendingLabel="Envoi…">Téléverser</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-semibold text-red-700">Suppression</h2>
            {deletable ? (
              <>
                <p className="text-sm text-slate-600">Suppression définitive autorisée pour les brouillons et produits archivés.</p>
                <ConfirmAction action={deleteProductAction} fields={{ id: p.id }} label="Supprimer le produit"
                  title={`Supprimer « ${p.name} » ?`}
                  description={<>Le produit <strong>{p.sku}</strong>, ses {images.length} image(s) et ses caractéristiques seront définitivement supprimés. Cette action est irréversible et enregistrée dans le journal d&apos;audit.</>}
                  confirmLabel="Supprimer définitivement" />
              </>
            ) : (
              <p className="text-sm text-slate-600">Pour retirer ce produit du site, passez son statut à « Archivé ». Un produit archivé peut ensuite être supprimé s&apos;il n&apos;est lié à aucun historique.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
