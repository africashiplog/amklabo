import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { Gallery } from "@/components/gallery";
import { PlainText } from "@/components/plain-text";
import { ProductImagePlaceholder, unitLabel } from "@/components/product-card";
import { Badge, LinkButton } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatMRU } from "@/lib/money";
import { getActor } from "@/server/current";
import { getPublicProduct } from "@/server/services/catalog";
import { getPriceContext, listVisibleTiers, quote } from "@/server/services/pricing";
import { getAvailability } from "@/server/services/stock";
import { mediaUrl } from "@/server/storage";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ qte?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getPublicProduct((await params).slug);
  return data ? { title: data.product.name, description: data.product.description?.slice(0, 160) } : { title: "Produit" };
}

const KIND_LABEL = { tier: "Tarif quantité", business_tier: "Tarif professionnel", customer: "Votre prix négocié" } as const;

export default async function ProductPage({ params, searchParams }: Props) {
  const data = await getPublicProduct((await params).slug);
  if (!data) notFound();
  const { product: p, images } = data;
  const unavailable = p.status === "unavailable";
  const actor = await getActor();
  const ctx = await getPriceContext(actor);
  const requested = Number((await searchParams)?.qte);
  const qty = Number.isInteger(requested) && requested >= p.min_order_qty && requested <= 1_000_000 ? requested : p.min_order_qty;
  // Tous les prix affichés sont calculés par le moteur de tarification côté serveur.
  const [current, tiers, stock] = await Promise.all([
    quote(ctx, p.id, qty), listVisibleTiers(ctx, p.id), getAvailability([p.id]),
  ]);
  const inStock = (stock.get(p.id) ?? 0) > 0;
  const discounted = current.unitPriceMinor < p.retail_price_minor;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Fil d'Ariane" className="mb-6 text-sm text-slate-500">
        <Link href="/catalogue" className="hover:text-brand-700">Catalogue</Link>
        {p.category_slug && <> / <Link href={`/categories/${p.category_slug}`} className="hover:text-brand-700">{p.category_name}</Link></>}
      </nav>
      <div className="grid gap-10 lg:grid-cols-2">
        {images.length > 0 ? (
          <Gallery name={p.name} images={images.map((i) => ({ id: i.id, url: mediaUrl(i.storage_path), alt: i.alt }))} />
        ) : (
          <ProductImagePlaceholder className="aspect-square rounded-xl border border-slate-200" />
        )}
        <div>
          {p.category_name && <p className="text-sm font-semibold text-leaf-700">{p.category_name}</p>}
          <h1 className="mt-1 text-3xl font-bold text-slate-900">{p.name}</h1>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <div><dt className="inline">Réf. : </dt><dd className="inline font-mono">{p.sku}</dd></div>
            {p.brand && <div><dt className="inline">Marque : </dt><dd className="inline font-medium">{p.brand}</dd></div>}
            {p.manufacturer && <div><dt className="inline">Fabricant : </dt><dd className="inline">{p.manufacturer}</dd></div>}
          </dl>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-600">
              {ctx.isBusiness ? "Votre prix professionnel" : "Prix"}{qty > 1 && <> pour {qty} unités de vente</>}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className={`text-3xl font-bold ${discounted ? "text-leaf-700" : "text-brand-800"}`}>{formatMRU(current.unitPriceMinor)}</span>
              <span className="text-slate-600">par {unitLabel(p)}</span>
              {discounted && <span className="text-sm text-slate-400 line-through">{formatMRU(p.retail_price_minor)}</span>}
            </p>
            {current.source !== "retail" && <p className="mt-1"><Badge tone="green">{current.label}</Badge></p>}
            {qty > 1 && <p className="mt-1 text-sm text-slate-700">Total : <strong>{formatMRU(current.lineTotalMinor)}</strong></p>}

            {tiers.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <caption className="mb-1 text-start text-sm font-semibold text-slate-800">Prix dégressifs</caption>
                <thead><tr className="text-start text-xs text-slate-500"><th className="py-1 text-start font-medium">Quantité</th><th className="py-1 text-start font-medium">Prix unitaire</th><th className="py-1 text-start font-medium">Type</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {tiers.map((t, i) => (
                    <tr key={i}><td className="py-1.5">dès {t.min_qty}</td><td className="py-1.5 font-semibold">{formatMRU(t.unit_price_minor)}</td><td className="py-1.5 text-slate-500">{KIND_LABEL[t.kind]}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <form className="mt-4 flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="qte" className="mb-1 block text-xs font-medium text-slate-600">Calculer le prix pour</label>
                <input id="qte" name="qte" type="number" min={p.min_order_qty} max={1000000} defaultValue={qty}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">Calculer</button>
            </form>

            <ul className="mt-4 space-y-1 text-sm text-slate-700">
              <li>Unité de vente : <strong>{t.saleUnit[p.sale_unit]}</strong>{p.units_per_sale_unit > 1 && <> ({p.units_per_sale_unit} unités)</>}</li>
              {p.min_order_qty > 1 && <li>Quantité minimale de commande : <strong>{p.min_order_qty}</strong></li>}
              <li>
                Disponibilité :{" "}
                {unavailable ? <Badge tone="amber">Indisponible actuellement</Badge>
                  : inStock ? <Badge tone="green">En stock</Badge> : <Badge>Rupture de stock</Badge>}
              </li>
            </ul>
            {!ctx.isBusiness && (
              <p className="mt-3 text-xs text-slate-500">
                Professionnel de santé ? <Link href="/espace-pro" className="font-semibold text-brand-700 underline">Demandez un compte professionnel</Link> pour accéder aux tarifs de gros.
              </p>
            )}
            {unavailable ? (
              <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Ce produit n&apos;est pas disponible à la commande actuellement.</p>
            ) : !inStock ? (
              <p className="mt-5 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">Rupture de stock : la commande en ligne reprendra dès le réapprovisionnement.</p>
            ) : actor ? (
              <AddToCart productId={p.id} minQty={p.min_order_qty} defaultQty={qty} back={`/produits/${p.slug}`} />
            ) : (
              <LinkButton href={`/connexion?next=${encodeURIComponent(`/produits/${p.slug}`)}`} variant="success" className="mt-5">Se connecter pour commander</LinkButton>
            )}
            <p className="mt-4 text-xs text-slate-500">
              Besoin d&apos;un devis ou d&apos;une grande quantité ?{" "}
              <Link href={`/contact?sujet=${encodeURIComponent(`Produit ${p.sku} — ${p.name} (quantité ${qty})`)}`} className="font-semibold text-brand-700 underline">Contactez-nous</Link>.
            </p>
          </div>

          {p.specs.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Caractéristiques techniques</h2>
              <dl className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
                {p.specs.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 gap-4 px-4 py-2.5">
                    <dt className="text-slate-500">{s.label}</dt><dd className="font-medium text-slate-800">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
      {p.description && (
        <section className="mt-10 max-w-3xl">
          <h2 className="text-lg font-semibold text-slate-900">Description</h2>
          <PlainText text={p.description} className="mt-3 text-slate-700" />
        </section>
      )}
    </div>
  );
}
