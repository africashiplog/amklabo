import { ActionForm, Checkbox, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { adminListMethods } from "@/server/services/payments";
import { saveMethodAction } from "../payment-actions";

export default async function PaymentMethodsPage() {
  const actor = await requirePermissionPage("settings.manage");
  const methods = await adminListMethods(actor);
  return (
    <>
      <PageHeader title="Moyens de paiement"
        description="Saisissez uniquement les comptes marchands officiels d'AMKLABO. Un moyen électronique ne peut pas être activé sans compte. Aucun code PIN ni mot de passe client n'est jamais demandé." />
      <div className="grid gap-6 lg:grid-cols-2">
        {methods.map((m) => (
          <Card key={m.code} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{m.name}</h2>
              {m.is_active ? <Badge tone="green">Actif</Badge> : <Badge>Désactivé</Badge>}
            </div>
            <ActionForm action={saveMethodAction}>
              <input type="hidden" name="code" value={m.code} />
              {m.kind === "mobile_money" && (
                <>
                  <Field name="merchantAccount" label="Numéro / compte marchand officiel" defaultValue={m.merchant_account ?? ""} />
                  <Field name="referenceLabel" label="Libellé de la référence demandée au client" defaultValue={m.reference_label} />
                </>
              )}
              {m.kind === "cash_on_delivery" && <input type="hidden" name="referenceLabel" value={m.reference_label} />}
              <Field name="instructions" label="Instructions affichées au client" as="textarea" rows={3} defaultValue={m.instructions ?? ""} />
              <Checkbox name="isActive" label="Proposer ce moyen de paiement" defaultChecked={m.is_active} />
              <SubmitButton size="sm">Enregistrer</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
