import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Alert, Card } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { listMyAddresses } from "@/server/services/customer-account";
import { getMyCart, shippingFee } from "@/server/services/orders";
import { listActiveZones } from "@/server/services/zones";
import { placeOrderAction } from "../../actions/shop";

export const metadata: Metadata = { title: "Validation de commande" };

export default async function CheckoutPage() {
  const actor = await requireActorPage("/commande");
  const cart = await getMyCart(actor).catch(() => null);
  if (!cart || cart.lines.length === 0 || !cart.canCheckout) redirect("/panier");
  const [addresses, zones] = await Promise.all([listMyAddresses(actor), listActiveZones()]);
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  // Frais et total calculés côté serveur pour chaque adresse.
  const options = addresses.map((a) => {
    const zone = a.zone_id ? zoneById.get(a.zone_id) : undefined;
    const fee = zone ? shippingFee(zone, cart.subtotalMinor) : null;
    return { a, zone, fee, total: fee === null ? null : cart.subtotalMinor + fee };
  });
  const usable = options.filter((o) => o.total !== null);
  const idempotencyKey = randomUUID().replace(/-/g, "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">Validation de la commande</h1>
      <ActionForm action={placeOrderAction} className="mt-6 grid gap-6 space-y-0 lg:grid-cols-[1fr_20rem]">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {options.map((o) => o.total !== null && <input key={o.a.id} type="hidden" name={`expected_${o.a.id}`} value={o.total} />)}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Adresse de livraison</h2>
            {zones.length === 0 && <Alert tone="warning">La livraison n&apos;est pas encore ouverte : aucune zone n&apos;est desservie pour le moment. <Link href="/contact" className="underline">Contactez-nous</Link>.</Alert>}
            {addresses.length === 0 && <p className="text-sm text-slate-600">Aucune adresse enregistrée.</p>}
            <fieldset className="space-y-2">
              <legend className="sr-only">Adresse de livraison</legend>
              {options.map(({ a, zone, fee }) => (
                <label key={a.id} className={`flex gap-3 rounded-lg border p-3 text-sm ${fee === null ? "border-slate-200 bg-slate-50 text-slate-400" : "cursor-pointer border-slate-300 hover:border-brand-500"}`}>
                  <input type="radio" name="addressId" value={a.id} disabled={fee === null} defaultChecked={fee !== null && a.id === usable[0]?.a.id} className="mt-1" />
                  <span>
                    <strong>{a.label}</strong> — {a.recipient}, {a.phone}<br />
                    {a.line1}{a.district ? `, ${a.district}` : ""}, {a.city}<br />
                    {zone ? <>Zone {zone.name} · livraison {fee === 0 ? "offerte" : formatMRU(fee!)}</> : <span className="text-red-700">Zone non desservie : modifiez l&apos;adresse</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            <Link href="/compte#adresses" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">+ Ajouter ou modifier une adresse</Link>
          </Card>
          <Card className="p-5">
            <Field name="note" label="Instructions pour la livraison" hint="(facultatif)" as="textarea" rows={3} />
          </Card>
          <Card className="p-5 text-sm text-slate-700">
            <h2 className="mb-2 font-semibold text-slate-900">Paiement</h2>
            <p>Aucun paiement n&apos;est demandé en ligne à cette étape. Après validation, notre équipe confirme votre commande et les modalités de règlement
              (paiement à la livraison, Bankily, Masrivi, Sedad, Bimbank ou Click selon les moyens ouverts).</p>
          </Card>
        </div>
        <Card className="h-fit space-y-3 p-5">
          <h2 className="font-semibold">Votre commande</h2>
          <ul className="space-y-1 text-sm">
            {cart.lines.map((l) => (
              <li key={l.product_id} className="flex justify-between gap-2"><span>{l.quantity} × {l.name}</span><span className="shrink-0">{formatMRU(l.quote!.lineTotalMinor)}</span></li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-slate-100 pt-2 text-sm"><span>Sous-total</span><span>{formatMRU(cart.subtotalMinor)}</span></p>
          {cart.discountMinor > 0 && <p className="flex justify-between text-sm text-leaf-700"><span>dont remises</span><span>{formatMRU(cart.discountMinor)}</span></p>}
          {usable.length > 0 && (
            <>
              <p className="flex justify-between text-sm"><span>Livraison</span><span>{usable.length === 1 || new Set(usable.map((u) => u.fee)).size === 1 ? formatMRU(usable[0].fee!) : "selon l'adresse"}</span></p>
              <p className="flex justify-between text-lg font-bold"><span>Total</span><span>{new Set(usable.map((u) => u.total)).size === 1 ? formatMRU(usable[0].total!) : "selon l'adresse"}</span></p>
            </>
          )}
          <p className="text-xs text-slate-500">En validant, vous acceptez les <Link href="/conditions-generales" className="underline" target="_blank">conditions générales de vente</Link>.</p>
          <SubmitButton variant="success" className="w-full" pendingLabel="Validation…">Valider la commande</SubmitButton>
        </Card>
      </ActionForm>
    </div>
  );
}
