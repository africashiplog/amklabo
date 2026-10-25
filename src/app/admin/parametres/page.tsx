import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { Logo } from "@/components/logo";
import { Card, PageHeader } from "@/components/ui";
import { minorToInput } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { getStoreSettings } from "@/server/services/settings";
import { resetLogoAction, saveSettingsAction, uploadLogoAction } from "../actions";

export default async function AdminSettings() {
  await requirePermissionPage("settings.manage");
  const s = await getStoreSettings();
  return (
    <>
      <PageHeader title="Paramètres du magasin" description="Coordonnées affichées sur le site et, plus tard, sur les factures. Laissez vide ce qui n'est pas encore confirmé." />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <ActionForm action={saveSettingsAction}>
          <Card className="space-y-4 p-6">
            <h2 className="font-semibold">Identité et coordonnées</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="storeName" label="Nom commercial" defaultValue={s.store_name} required />
              <Field name="tagline" label="Signature" defaultValue={s.tagline} />
              <Field name="phone" label="Téléphone" defaultValue={s.phone ?? ""} />
              <Field name="whatsapp" label="WhatsApp" defaultValue={s.whatsapp ?? ""} />
              <Field name="email" label="E-mail" type="email" defaultValue={s.email ?? ""} />
              <Field name="city" label="Ville" defaultValue={s.city ?? ""} />
            </div>
            <Field name="addressLine" label="Adresse" defaultValue={s.address_line ?? ""} />
            <Field name="openingHours" label="Horaires d'ouverture" defaultValue={s.opening_hours ?? ""} />
          </Card>
          <Card className="space-y-4 p-6">
            <h2 className="font-semibold">Facturation</h2>
            <p className="text-xs text-slate-500">Ces informations sont figées sur chaque facture au moment de son émission. Leur conformité doit être vérifiée par AMKLABO.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="legalName" label="Raison sociale" defaultValue={s.legal_name ?? ""} />
              <Field name="taxId" label="NIF" defaultValue={s.tax_id ?? ""} />
              <Field name="tradeRegister" label="Registre du commerce" defaultValue={s.trade_register ?? ""} />
            </div>
            <Field name="bankDetails" label="Coordonnées bancaires / de paiement" as="textarea" rows={3} defaultValue={s.bank_details ?? ""} />
            <Field name="invoiceFooter" label="Mention de pied de facture" as="textarea" rows={2} defaultValue={s.invoice_footer ?? ""} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="taxRate" label="Taux de taxe inclus (%)" hint="(0 = aucune)" inputMode="decimal" defaultValue={minorToInput(s.tax_rate_bp)} />
              <Field name="taxLabel" label="Libellé de la taxe" defaultValue={s.tax_label} />
              <Field name="invoiceDueDays" label="Échéance (jours)" type="number" min={0} max={365} defaultValue={s.invoice_due_days} />
            </div>
            <p className="text-xs text-amber-800">Les prix saisis sont des prix finaux. Si un taux est indiqué, la facture affiche la part de taxe incluse. À configurer uniquement après validation du régime fiscal applicable.</p>
          </Card>
          <Card className="space-y-4 p-6">
            <h2 className="font-semibold">Stock et retours</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="expiryAlertDays" label="Alerte de péremption (jours avant la date)" type="number" min={1} max={730} defaultValue={s.expiry_alert_days} />
              <Field name="returnWindowDays" label="Délai de demande de retour (jours après livraison, 0 = désactivé)" type="number" min={0} max={365} defaultValue={s.return_window_days} />
            </div>
          </Card>
          <div><SubmitButton>Enregistrer les paramètres</SubmitButton></div>
        </ActionForm>

        <Card className="h-fit space-y-4 p-5">
          <h2 className="font-semibold">Logo</h2>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><Logo logoPath={s.logo_path} name={s.store_name} className="mx-auto h-20" /></div>
          <p className="text-xs text-slate-500">{s.logo_path ? "Logo de remplacement actif." : "Logo officiel AMKLABO fourni par le propriétaire."} Les proportions sont toujours conservées.</p>
          <ActionForm action={uploadLogoAction} resetOnSuccess>
            <Field name="logo" label="Remplacer le logo" hint="(PNG ou JPEG, 5 Mo max)" type="file" accept="image/png,image/jpeg" required />
            <SubmitButton variant="secondary" pendingLabel="Envoi…">Téléverser</SubmitButton>
          </ActionForm>
          {s.logo_path && (
            <ConfirmAction action={resetLogoAction} fields={{}} label="Rétablir le logo d'origine" variant="secondary"
              title="Rétablir le logo officiel ?" description="Le logo de remplacement sera supprimé et le logo officiel AMKLABO d'origine sera de nouveau utilisé." />
          )}
        </Card>
      </div>
    </>
  );
}
