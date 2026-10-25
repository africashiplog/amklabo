import type { Metadata } from "next";
import Link from "next/link";
import { CartLineForm } from "@/components/cart-line-form";
import { ProductImagePlaceholder, unitLabel } from "@/components/product-card";
import { Alert, Card, EmptyState, LinkButton } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { getMyCart } from "@/server/services/orders";
import { mediaUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Panier" };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ recommande?: string }> }) {
  const actor = await requireActorPage("/panier");
  const { recommande } = await searchParams;
  const cart = await getMyCart(actor).catch((e: Error) => e);
  if (cart instanceof Error) {
    return <div className="mx-auto max-w-3xl px-4 py-10"><Alert tone="info">{cart.message}</Alert></div>;
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">Panier</h1>
      {recommande && <div className="mt-4"><Alert tone="success">Les produits disponibles de votre commande ont été ajoutés au panier. Les prix sont ceux d&apos;aujourd&apos;hui.</Alert></div>}
      {cart.lines.length === 0 ? (
        <div className="mt-6"><EmptyState title="Votre panier est vide"><Link href="/catalogue" className="font-semibold text-brand-700 underline">Parcourir le catalogue</Link></EmptyState></div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <ul className="space-y-3">
            {cart.lines.map((l) => (
              <li key={l.product_id}>
                <Card className="flex gap-4 p-4">
                  <Link href={`/produits/${l.slug}`} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                    {l.cover_path
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={mediaUrl(l.cover_path)} alt="" className="h-full w-full object-contain p-1" />
                      : <ProductImagePlaceholder className="h-full w-full" />}
                  </Link>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <Link href={`/produits/${l.slug}`} className="font-semibold text-slate-900 hover:text-brand-700">{l.name}</Link>
                      {l.quote && <span className="font-bold text-brand-800">{formatMRU(l.quote.lineTotalMinor)}</span>}
                    </div>
                    <p className="text-xs text-slate-500">Réf. {l.sku}</p>
                    {l.quote && (
                      <p className="text-sm text-slate-700">
                        {formatMRU(l.quote.unitPriceMinor)} / {unitLabel(l)}
                        {l.quote.unitPriceMinor < l.quote.retailUnitPriceMinor && <span className="ms-2 text-xs text-leaf-700">{l.quote.label} (au lieu de {formatMRU(l.quote.retailUnitPriceMinor)})</span>}
                      </p>
                    )}
                    {l.issue && <p className="text-sm font-medium text-red-700">{l.issue}</p>}
                    <CartLineForm productId={l.product_id} quantity={l.quantity} min={l.min_order_qty} name={l.name} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Card className="h-fit space-y-3 p-5">
            <h2 className="font-semibold">Récapitulatif</h2>
            {cart.discountMinor > 0 && (
              <p className="flex justify-between text-sm text-slate-600"><span>Prix public</span><span className="line-through">{formatMRU(cart.retailSubtotalMinor)}</span></p>
            )}
            {cart.discountMinor > 0 && <p className="flex justify-between text-sm text-leaf-700"><span>Remises</span><span>−{formatMRU(cart.discountMinor)}</span></p>}
            <p className="flex justify-between text-lg font-bold"><span>Sous-total</span><span>{formatMRU(cart.subtotalMinor)}</span></p>
            <p className="text-xs text-slate-500">Les frais de livraison sont calculés à l&apos;étape suivante selon votre adresse. Les prix sont recalculés par nos serveurs à la validation.</p>
            {cart.canCheckout
              ? <LinkButton href="/commande" variant="success" className="w-full">Passer la commande</LinkButton>
              : <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Corrigez les produits signalés pour continuer.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
