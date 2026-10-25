import { ActionForm, Checkbox, Field, SubmitButton } from "./forms";
import type { Address } from "@/server/services/customer-account";
import type { DeliveryZone } from "@/server/services/zones";
import { saveAddressAction } from "@/app/actions/site";

export function AddressForm({ address, zones }: { address?: Address; zones: DeliveryZone[] }) {
  return (
    <ActionForm action={saveAddressAction} resetOnSuccess={!address}>
      {address && <input type="hidden" name="id" value={address.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="label" label="Nom de l'adresse" defaultValue={address?.label ?? "Domicile"} required />
        <Field name="recipient" label="Destinataire" defaultValue={address?.recipient} required />
        <Field name="phone" label="Téléphone" type="tel" defaultValue={address?.phone} required />
        <Field name="city" label="Ville" defaultValue={address?.city ?? "Nouakchott"} required />
        <Field name="district" label="Quartier / Moughataa" defaultValue={address?.district ?? ""} />
        <Field name="zoneId" label="Zone de livraison" as="select" defaultValue={address?.zone_id ?? ""}>
          <option value="">{zones.length ? "— Choisir —" : "Aucune zone active pour le moment"}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </Field>
      </div>
      <Field name="line1" label="Adresse" hint="(rue, îlot, numéro…)" defaultValue={address?.line1} required />
      <Field name="landmark" label="Point de repère" defaultValue={address?.landmark ?? ""} />
      <Checkbox name="isDefault" label="Adresse par défaut" defaultChecked={address?.is_default} />
      <SubmitButton>{address ? "Enregistrer les modifications" : "Ajouter l'adresse"}</SubmitButton>
    </ActionForm>
  );
}
