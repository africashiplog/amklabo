import { ActionForm, Checkbox, Field, SubmitButton } from "./forms";
import type { Supplier } from "@/server/services/purchasing";
import { saveSupplierAction } from "@/app/admin/stock-actions";

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <ActionForm action={saveSupplierAction} resetOnSuccess={!supplier}>
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <Field name="name" label="Nom" defaultValue={supplier?.name} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="contactName" label="Contact" defaultValue={supplier?.contact_name ?? ""} />
        <Field name="phone" label="Téléphone" defaultValue={supplier?.phone ?? ""} />
        <Field name="email" label="E-mail" type="email" defaultValue={supplier?.email ?? ""} />
        <Field name="country" label="Pays" defaultValue={supplier?.country ?? ""} />
      </div>
      <Field name="address" label="Adresse" defaultValue={supplier?.address ?? ""} />
      <Field name="notes" label="Notes" as="textarea" rows={2} defaultValue={supplier?.notes ?? ""} />
      <Checkbox name="isActive" label="Actif" defaultChecked={supplier?.is_active ?? true} />
      <SubmitButton size="sm">{supplier ? "Enregistrer" : "Ajouter le fournisseur"}</SubmitButton>
    </ActionForm>
  );
}
