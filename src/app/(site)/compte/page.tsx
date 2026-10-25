import type { Metadata } from "next";
import Link from "next/link";
import { AddressForm } from "@/components/address-form";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDate } from "@/lib/format";
import { requireActorPage } from "@/server/current";
import { can } from "@/server/permissions";
import { getMyProfile, listMyAddresses } from "@/server/services/customer-account";
import { listActiveZones } from "@/server/services/zones";
import { logoutAction } from "../../actions/auth";
import { changePasswordAction, deleteAddressAction, updateProfileAction } from "../../actions/site";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ bienvenue?: string }> }) {
  const actor = await requireActorPage("/compte");
  const { bienvenue } = await searchParams;
  const [profile, addresses, zones] = await Promise.all([getMyProfile(actor), listMyAddresses(actor), listActiveZones()]);
  const isStaff = can(actor.roles, "admin.access");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mon compte</h1>
          <p className="mt-1 text-sm text-slate-600">
            {profile?.email} · {profile?.customer_type ? t.customerType[profile.customer_type as "retail" | "business"] : "Personnel"}
            {profile && <> · inscrit le {formatDate(profile.created_at)}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {isStaff && <Link href="/admin" className="rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700">Administration</Link>}
          <form action={logoutAction}><button className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Se déconnecter</button></form>
        </div>
      </div>
      {bienvenue && <div className="mt-4"><Alert tone="success">Bienvenue ! Votre compte a été créé.</Alert></div>}
      <div className="mt-4"><Alert tone="info">
        Le suivi des commandes, des factures et des paiements sera disponible dans votre espace dès l&apos;ouverture de la commande en ligne.
      </Alert></div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Informations personnelles</h2>
          <ActionForm action={updateProfileAction}>
            <Field name="fullName" label="Nom complet" defaultValue={profile?.full_name} required />
            <Field name="phone" label="Téléphone" type="tel" defaultValue={profile?.phone ?? ""} required />
            <SubmitButton>Enregistrer</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Mot de passe</h2>
          <ActionForm action={changePasswordAction}>
            <Field name="current" label="Mot de passe actuel" type="password" autoComplete="current-password" required />
            <Field name="next" label="Nouveau mot de passe" hint="(10 caractères minimum)" type="password" autoComplete="new-password" required />
            <Field name="confirm" label="Confirmer" type="password" autoComplete="new-password" required />
            <p className="text-xs text-slate-500">Toutes vos sessions seront fermées ; vous devrez vous reconnecter.</p>
            <SubmitButton>Changer le mot de passe</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      {profile?.customer_type && (
        <section id="adresses" className="mt-10 scroll-mt-24">
          <h2 className="mb-4 text-xl font-semibold">Mes adresses</h2>
          {addresses.length > 0 && (
            <ul className="mb-6 grid gap-4 sm:grid-cols-2">
              {addresses.map((a) => (
                <li key={a.id}>
                  <Card className="h-full p-5">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{a.label}</p>
                      {a.is_default && <Badge tone="green">Par défaut</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{a.recipient} · {a.phone}</p>
                    <p className="text-sm text-slate-600">{a.line1}{a.district ? `, ${a.district}` : ""}, {a.city}</p>
                    {a.landmark && <p className="text-sm text-slate-500">Repère : {a.landmark}</p>}
                    {a.zone_name && <p className="text-sm text-slate-500">Zone : {a.zone_name}</p>}
                    <div className="mt-3 flex gap-2">
                      <Link href={`/compte/adresses/${a.id}`} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">Modifier</Link>
                      <ConfirmAction action={deleteAddressAction} fields={{ id: a.id }} label="Supprimer"
                        title="Supprimer cette adresse ?"
                        description={<>L&apos;adresse « {a.label} » ({a.line1}, {a.city}) sera définitivement supprimée de votre compte.</>}
                        confirmLabel="Supprimer" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Card className="p-6">
            <h3 className="mb-4 font-semibold">Ajouter une adresse</h3>
            <AddressForm zones={zones} />
          </Card>
        </section>
      )}
    </div>
  );
}
