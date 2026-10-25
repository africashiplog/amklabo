import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { getActor } from "@/server/current";
import { loginAction } from "../../actions/auth";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getActor()) redirect("/compte");
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Connexion</h1>
        <p className="mt-1 text-sm text-slate-600">Accédez à votre espace client AMKLABO.</p>
        <ActionForm action={loginAction} className="mt-6">
          <input type="hidden" name="next" value={next ?? "/compte"} />
          <Field name="email" label="Adresse e-mail" type="email" autoComplete="email" required />
          <Field name="password" label="Mot de passe" type="password" autoComplete="current-password" required />
          <SubmitButton className="w-full" pendingLabel="Connexion…">Se connecter</SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-sm text-slate-600">
          Pas encore de compte ? <Link href="/inscription" className="font-semibold text-brand-700 hover:underline">Créer un compte</Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          Mot de passe oublié ? <Link href="/contact?sujet=R%C3%A9initialisation%20du%20mot%20de%20passe" className="underline">Contactez-nous</Link> : après vérification de votre identité, nous vous communiquerons un mot de passe temporaire.
        </p>
      </Card>
    </div>
  );
}
