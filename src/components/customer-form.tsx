import { ActionForm, Field, SubmitButton } from "./forms";
import type { CustomerDetail } from "@/server/services/customers";
import { createCustomerAction, updateCustomerAction } from "@/app/admin/customer-actions";

export function CustomerForm({ customer }: { customer?: CustomerDetail }) {
  return (
    <ActionForm action={customer ? updateCustomerAction : createCustomerAction}>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="fullName" label="Nom ou raison sociale" defaultValue={customer?.full_name} required />
        <Field name="phone" label="Téléphone" type="tel" defaultValue={customer?.phone ?? ""} required />
        <Field name="email" label="E-mail" type="email" defaultValue={customer?.email ?? ""}
          hint={customer?.user_id ? "(contact ; l'e-mail de connexion n'est pas modifié)" : undefined} />
        <Field name="customerType" label="Type de client" as="select" defaultValue={customer?.customer_type ?? "retail"}>
          <option value="retail">Particulier</option>
          <option value="business">Professionnel</option>
        </Field>
      </div>
      <p className="text-xs text-slate-500">Le type « Professionnel » permet d&apos;associer des prix négociés ; les tarifs de gros ne s&apos;appliquent qu&apos;avec un compte professionnel approuvé.</p>
      <SubmitButton>{customer ? "Enregistrer" : "Créer le client"}</SubmitButton>
    </ActionForm>
  );
}
