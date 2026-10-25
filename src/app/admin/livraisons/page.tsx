import Link from "next/link";
import { ShipmentList } from "@/components/shipment-list";
import { PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { adminListShipments, DELIVERY_STATUS } from "@/server/services/deliveries";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await requirePermissionPage("deliveries.manage");
  const status = (await searchParams).statut ?? "active";
  const rows = await adminListShipments(actor, status);
  return (
    <>
      <PageHeader title="Livraisons" description="Une livraison est créée lorsque la commande est « Prête à expédier »." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["active", "En cours"], ...Object.entries(DELIVERY_STATUS), ["all", "Toutes"]].map(([k, label]) => (
          <Link key={k} href={`/admin/livraisons?statut=${k}`}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${status === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      <ShipmentList rows={rows} showDriver />
    </>
  );
}
