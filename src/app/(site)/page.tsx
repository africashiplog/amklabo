import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { LinkButton } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { getActor } from "@/server/current";
import { enrichProducts } from "@/server/services/storefront";
import { listFeaturedProducts, listNewestProducts, listPublicCategories } from "@/server/services/catalog";
import { getStoreSettings } from "@/server/services/settings";
import { listActiveZones } from "@/server/services/zones";

export default async function HomePage() {
  const [categories, featured, newest, zones, settings] = await Promise.all([
    listPublicCategories(), listFeaturedProducts(8), listNewestProducts(8), listActiveZones(), getStoreSettings(),
  ]);
  const { prices, stock } = await enrichProducts(await getActor(), [...featured, ...newest]);
  const topCategories = categories.filter((c) => !c.parent_id);

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 text-white">
        <div className="absolute -end-24 -top-24 h-96 w-96 rounded-full bg-leaf-500/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-widest text-leaf-100">{settings.tagline}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            Matériel médical et de laboratoire pour les professionnels et les particuliers en Mauritanie
          </h1>
          <p className="mt-4 max-w-2xl text-brand-100">
            Tubes de prélèvement, seringues, gants, consommables de laboratoire, équipements et appareils de mesure.
          </p>
          <form action="/catalogue" role="search" className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
            <label htmlFor="q-hero" className="sr-only">Rechercher un produit</label>
            <input id="q-hero" name="q" type="search" placeholder="Que recherchez-vous ?"
              className="flex-1 rounded-lg border-0 px-4 py-3 text-slate-900 shadow focus:outline-none focus:ring-4 focus:ring-leaf-500/40" />
            <button className="rounded-lg bg-leaf-600 px-6 py-3 font-semibold text-white shadow hover:bg-leaf-700">Rechercher</button>
          </form>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link href="/catalogue" className="rounded-full bg-white/10 px-4 py-2 font-medium ring-1 ring-white/30 hover:bg-white/20">Voir tout le catalogue</Link>
            <Link href="/espace-pro" className="rounded-full bg-white/10 px-4 py-2 font-medium ring-1 ring-white/30 hover:bg-white/20">Espace professionnels</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Nos catégories</h2>
          <Link href="/categories" className="text-sm font-semibold text-brand-700 hover:underline">Toutes les catégories →</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {topCategories.map((c) => (
            <Link key={c.id} href={`/categories/${c.slug}`}
              className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-leaf-500 hover:shadow-md">
              <span className="mb-3 block h-1 w-10 rounded-full bg-gradient-to-r from-brand-600 to-leaf-500" aria-hidden />
              <span className="block font-semibold text-slate-900 group-hover:text-brand-700">{c.name}</span>
              <span className="mt-1 block text-xs text-slate-500">{c.product_count} produit{c.product_count > 1 ? "s" : ""}</span>
            </Link>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-6">
          <h2 className="mb-6 text-2xl font-bold text-slate-900">Produits mis en avant</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} price={prices.get(p.id)} stock={stock.get(p.id)} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Nouveautés</h2>
          <Link href="/catalogue" className="text-sm font-semibold text-brand-700 hover:underline">Voir le catalogue →</Link>
        </div>
        {newest.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {newest.map((p) => <ProductCard key={p.id} product={p} price={prices.get(p.id)} stock={stock.get(p.id)} />)}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            Le catalogue est en cours de préparation. Revenez bientôt ou contactez-nous pour toute demande.
          </p>
        )}
      </section>

      <section id="professionnels" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-12">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-leaf-600 p-6 text-white lg:col-span-1">
            <h2 className="text-xl font-bold">Professionnels de santé</h2>
            <p className="mt-2 text-sm text-leaf-50">
              Laboratoires, cliniques, hôpitaux, pharmacies, cabinets et distributeurs : des tarifs de gros
              et des paliers par quantité seront proposés aux comptes professionnels validés.
            </p>
            <p className="mt-3 text-sm text-leaf-50">
              Déposez votre demande de compte professionnel : notre équipe l&apos;examine et active vos tarifs.
            </p>
            <LinkButton href="/espace-pro" variant="secondary" className="mt-4">Demander un compte professionnel</LinkButton>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900">Livraison</h2>
            {zones.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {zones.map((z) => (
                  <li key={z.id} className="flex justify-between gap-2">
                    <span>{z.name}</span>
                    <span className="font-medium">{z.fee_minor === 0 ? "Gratuite" : formatMRU(z.fee_minor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Première zone desservie : Nouakchott. Les frais de livraison seront précisés prochainement.</p>
            )}
            <Link href="/livraison-retours" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Politique de livraison →</Link>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900">Paiement</h2>
            <p className="mt-3 text-sm text-slate-600">
              Moyens de paiement prévus à l&apos;ouverture de la commande en ligne : paiement à la livraison,
              Bankily, Masrivi, Sedad, Bimbank et Click.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
