import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, LinkButton } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getActor } from "@/server/current";
import { ACTIVITIES, BUSINESS_STATUS, getMyBusinessAccount } from "@/server/services/business";
import { getMyProfile } from "@/server/services/customer-account";
import { businessRequestAction } from "../../actions/site";

export const metadata: Metadata = { title: "Espace professionnels" };

const tone = { pending: "amber", approved: "green", rejected: "red", suspended: "red" } as const;

export default async function ProPage({ searchParams }: { searchParams: Promise<{ envoye?: string }> }) {
  const actor = await getActor();
  const { envoye } = await searchParams;
  const [account, profile] = actor ? await Promise.all([getMyBusinessAccount(actor), getMyProfile(actor)]) : [null, null];
  const canRequest = actor && profile?.customer_type && (!account || account.status === "rejected");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wider text-leaf-700">Vente en gros</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">Espace professionnels de santé</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Tarifs de gros", "Des prix dégressifs par paliers de quantité, réservés aux comptes approuvés."],
          ["Prix négociés", "Des conditions spécifiques peuvent être accordées à votre établissement."],
          ["Commandes en volume", "Boîtes, cartons et lots pour les besoins des laboratoires et structures de soins."],
        ].map(([t, d]) => (
          <Card key={t} className="p-5"><p className="font-semibold text-brand-800">{t}</p><p className="mt-1 text-sm text-slate-600">{d}</p></Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Laboratoires, cliniques, hôpitaux, pharmacies, cabinets médicaux, distributeurs, entreprises et organismes.
        Chaque demande est examinée par notre équipe ; les tarifs professionnels sont visibles uniquement après approbation.
      </p>

      <div className="mt-8">
        {envoye && <div className="mb-4"><Alert tone="success">Votre demande a été envoyée. Nous l&apos;examinerons dans les meilleurs délais.</Alert></div>}
        {!actor && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Déposer une demande</h2>
            <p className="mt-1 text-sm text-slate-600">Créez d&apos;abord un compte client (ou connectez-vous), puis complétez la demande professionnelle.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href="/inscription">Créer un compte</LinkButton>
              <LinkButton href="/connexion?next=/espace-pro" variant="secondary">Se connecter</LinkButton>
            </div>
          </Card>
        )}
        {account && (
          <Card className="mb-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{account.establishment_name}</h2>
              <Badge tone={tone[account.status]}>{BUSINESS_STATUS[account.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">{ACTIVITIES[account.activity]} · demande du {formatDate(account.submitted_at)}</p>
            {account.status === "approved" && <p className="mt-3 text-sm text-leaf-700">Vos tarifs professionnels sont affichés sur les fiches produits lorsque vous êtes connecté.</p>}
            {account.status === "pending" && <p className="mt-3 text-sm text-slate-600">Votre demande est en cours d&apos;examen.</p>}
            {account.decision_reason && account.status !== "approved" && (
              <p className="mt-3 text-sm text-slate-700">Motif communiqué : {account.decision_reason}</p>
            )}
          </Card>
        )}
        {actor && !profile?.customer_type && (
          <Alert tone="info">Les comptes du personnel ne peuvent pas déposer de demande professionnelle.</Alert>
        )}
        {canRequest && (
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">{account ? "Nouvelle demande" : "Demande de compte professionnel"}</h2>
            <ActionForm action={businessRequestAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="establishmentName" label="Nom de l'établissement" defaultValue={account?.establishment_name} required />
                <Field name="activity" label="Activité" as="select" defaultValue={account?.activity ?? ""} required>
                  <option value="">— Choisir —</option>
                  {Object.entries(ACTIVITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Field>
                <Field name="contactName" label="Personne à contacter" defaultValue={account?.contact_name ?? profile?.full_name} required />
                <Field name="phone" label="Téléphone" type="tel" defaultValue={account?.phone ?? profile?.phone ?? ""} required />
                <Field name="email" label="E-mail professionnel" type="email" defaultValue={account?.email ?? profile?.email ?? ""} />
                <Field name="professionalId" label="Identifiant professionnel" hint="(NIF, agrément… si disponible)" defaultValue={account?.professional_id ?? ""} />
                <Field name="addressLine" label="Adresse" defaultValue={account?.address_line} required />
                <Field name="city" label="Ville" defaultValue={account?.city ?? "Nouakchott"} required />
              </div>
              <Field name="message" label="Besoins / informations complémentaires" as="textarea" rows={3} defaultValue={account?.message ?? ""} />
              <SubmitButton pendingLabel="Envoi…">Envoyer la demande</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
