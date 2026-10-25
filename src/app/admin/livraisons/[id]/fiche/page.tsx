import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { t } from "@/i18n/fr";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { DELIVERY_STATUS, getShipment } from "@/server/services/deliveries";
import { getStoreSettings } from "@/server/services/settings";

/** Fiche de livraison imprimable. */
export default async function DeliverySlip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActorPage(`/admin/livraisons/${id}/fiche`);
  const data = await getShipment(actor, id);
  if (!data) notFound();
  const settings = await getStoreSettings();
  const { shipment: s, items, amountToCollect } = data;
  return (
    <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 text-sm text-slate-900 shadow-sm print:shadow-none">
      <div className="mb-6 flex items-start justify-between print:hidden"><PrintButton /></div>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <Logo logoPath={settings.logo_path} name={settings.store_name} className="h-14" />
        <div className="text-end">
          <p className="text-lg font-bold">FICHE DE LIVRAISON</p>
          <p className="font-mono">{s.order_number}</p>
          <p>{DELIVERY_STATUS[s.status]}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase text-slate-500">Client</p>
          <p className="font-semibold">{s.ship_recipient}</p>
          {s.business_name && <p>{s.business_name}</p>}
          <p>Tél. : {s.ship_phone}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Adresse</p>
          <p>{s.ship_line1}{s.ship_district ? `, ${s.ship_district}` : ""}</p>
          <p>{s.ship_city} — zone {s.zone_name}</p>
          {s.ship_landmark && <p>Repère : {s.ship_landmark}</p>}
        </div>
      </div>
      {s.customer_note && <p className="mt-3 rounded border border-slate-300 p-2">Instructions : {s.customer_note}</p>}
      <table className="mt-4 w-full border-collapse">
        <thead><tr className="border-b border-slate-300 text-start"><th className="py-1 text-start">Qté</th><th className="py-1 text-start">Article</th><th className="py-1 text-start">Réf.</th></tr></thead>
        <tbody>{items.map((i, k) => <tr key={k} className="border-b border-slate-100"><td className="py-1">{i.quantity}</td><td className="py-1">{i.name} ({t.saleUnit[i.sale_unit as "box"].toLowerCase()})</td><td className="py-1 font-mono text-xs">{i.sku}</td></tr>)}</tbody>
      </table>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <p><span className="text-xs uppercase text-slate-500">Livreur</span><br />{s.driver_name ?? s.carrier_name ?? "—"}{s.tracking_number ? ` · ${s.tracking_number}` : ""}</p>
        <p className="text-end"><span className="text-xs uppercase text-slate-500">Montant à encaisser</span><br /><span className="text-lg font-bold">{s.payment_method_code === "cash_on_delivery" ? formatMRU(amountToCollect) : "Aucun (paiement électronique)"}</span></p>
      </div>
      <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-slate-500">
        <p className="border-t border-slate-400 pt-1">Signature du client</p>
        <p className="border-t border-slate-400 pt-1">Signature du livreur</p>
      </div>
    </div>
  );
}
