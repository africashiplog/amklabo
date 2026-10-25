import { ActionForm, Checkbox, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatMRU, minorToInput } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { adminListZones, type DeliveryZone } from "@/server/services/zones";
import { saveZoneAction } from "../actions";

function ZoneForm({ zone }: { zone?: DeliveryZone }) {
  return (
    <ActionForm action={saveZoneAction} resetOnSuccess={!zone}>
      {zone && <input type="hidden" name="id" value={zone.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Nom de la zone" defaultValue={zone?.name} required />
        <Field name="city" label="Ville" defaultValue={zone?.city ?? "Nouakchott"} required />
        <Field name="fee" label="Frais de livraison (MRU)" inputMode="decimal" defaultValue={zone ? minorToInput(zone.fee_minor) : ""} required />
        <Field name="freeThreshold" label="Gratuite à partir de (MRU)" hint="(facultatif)" inputMode="decimal"
          defaultValue={zone?.free_shipping_threshold_minor != null ? minorToInput(zone.free_shipping_threshold_minor) : ""} />
      </div>
      <Checkbox name="isActive" label="Zone active (proposée aux clients)" defaultChecked={zone?.is_active} />
      <SubmitButton size="sm">{zone ? "Enregistrer" : "Ajouter la zone"}</SubmitButton>
    </ActionForm>
  );
}

export default async function AdminZones() {
  const actor = await requirePermissionPage("settings.manage");
  const zones = await adminListZones(actor);
  return (
    <>
      <PageHeader title="Zones de livraison" description="Les frais seront appliqués et recalculés côté serveur lors de la commande (Phase 3)." />
      <div className="grid gap-6 lg:grid-cols-2">
        {zones.map((z) => (
          <Card key={z.id} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{z.name}</h2>
              {z.is_active ? <Badge tone="green">Active · {formatMRU(z.fee_minor)}</Badge> : <Badge>Inactive</Badge>}
            </div>
            <ZoneForm zone={z} />
          </Card>
        ))}
        <Card className="p-5"><h2 className="mb-3 font-semibold">Nouvelle zone</h2><ZoneForm /></Card>
      </div>
    </>
  );
}
