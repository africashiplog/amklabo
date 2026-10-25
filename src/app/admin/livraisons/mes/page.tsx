import { ShipmentList } from "@/components/shipment-list";
import { PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { listMyDeliveries } from "@/server/services/deliveries";

export default async function MyDeliveriesPage() {
  const actor = await requirePermissionPage("deliveries.own");
  const rows = await listMyDeliveries(actor);
  return (
    <>
      <PageHeader title="Mes livraisons" description="Livraisons qui vous sont attribuées (et celles livrées ces 7 derniers jours)." />
      <ShipmentList rows={rows} showDriver={false} />
    </>
  );
}
