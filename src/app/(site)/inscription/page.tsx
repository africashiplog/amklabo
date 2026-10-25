import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Checkbox, Field, SubmitButton, } from "@/components/forms";
import { Card } from "@/components/ui";
import { getActor } from "@/server/current";
import { registerAction } from "../../actions/auth";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function RegisterPage() {
  if (await getActor()) redirect("/compte");
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Créer un compte</h1>
        <p className="mt-1 text-sm text-slate-600">Compte client particulier. Les comptes professionnels seront ouverts prochainement.</p>
        <ActionForm action={registerAction} className="mt-6">
          <Field name="fullName" label="Nom complet" autoComplete="name" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" required />
            <Field name="phone" label="Téléphone" type="tel" autoComplete="tel" placeholder="+222 …" required />
          </div>
          <Field name="password" label="Mot de passe" hint="(10 caractères minimum)" type="password" autoComplete="new-password" required />
          <Field name="confirm" label="Confirmer le mot de passe" type="password" autoComplete="new-password" required />
          <div>
            <Checkbox name="terms" label="J'accepte les conditions générales et la politique de confidentialité" />
            <p className="mt-1 text-xs text-slate-500">
              <Link href="/conditions-generales" className="underline" target="_blank">Conditions générales</Link> ·{" "}
              <Link href="/confidentialite" className="underline" target="_blank">Confidentialité</Link>
            </p>
          </div>
          <SubmitButton className="w-full" pendingLabel="Création…">Créer mon compte</SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-sm text-slate-600">
          Déjà inscrit ? <Link href="/connexion" className="font-semibold text-brand-700 hover:underline">Se connecter</Link>
        </p>
      </Card>
    </div>
  );
}
