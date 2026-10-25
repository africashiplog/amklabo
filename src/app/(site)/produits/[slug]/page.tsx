import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { PlainText } from "@/components/plain-text";
import { ProductImagePlaceholder, unitLabel } from "@/components/product-card";
import { Badge, LinkButton } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatMRU } from "@/lib/money";
import { getPublicProduct } from "@/server/services/catalog";
import { mediaUrl } from "@/server/storage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getPublicProduct((await params).slug);
  return data ? { title: data.product.name, description: data.product.description?.slice(0, 160) } : { title: "Produit" };
}

export default async function ProductPage({ params }: Props) {
  const data = await getPublicProduct((await params).slug);
  if (!data) notFound();
  const { product: p, images } = data;
  const unavailable = p.status === "unavailable";

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
            <p className="text-sm text-slate-600">Prix public</p>
            <p className="mt-1">
              <span className="text-3xl font-bold text-brand-800">{formatMRU(p.retail_price_minor)}</span>
              <span className="ms-2 text-slate-600">par {unitLabel(p)}</span>
            </p>
            <ul className="mt-4 space-y-1 text-sm text-slate-700">
              <li>Unité de vente : <strong>{t.saleUnit[p.sale_unit]}</strong>{p.units_per_sale_unit > 1 && <> ({p.units_per_sale_unit} unités)</>}</li>
              {p.min_order_qty > 1 && <li>Quantité minimale de commande : <strong>{p.min_order_qty}</strong></li>}
              <li>
                Disponibilité :{" "}
                {unavailable ? <Badge tone="amber">Indisponible actuellement</Badge> : <span>confirmée par notre équipe lors de la commande</span>}
              </li>
            </ul>
            <div className="mt-5 rounded-lg bg-brand-50 p-4 text-sm text-brand-900">
              La commande en ligne sera bientôt disponible. Pour commander dès maintenant ou demander un tarif
              professionnel, contactez-nous en indiquant la référence <span className="font-mono">{p.sku}</span>.
            </div>
            <LinkButton href={`/contact?sujet=${encodeURIComponent(`Produit ${p.sku} — ${p.name}`)}`} className="mt-4 w-full sm:w-auto">
              Demander ce produit
            </LinkButton>
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
