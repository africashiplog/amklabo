import { LinkButton } from "@/components/ui";

export default function AccessDenied() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Accès refusé</h1>
      <p className="mt-2 text-slate-600">Votre rôle ne permet pas d&apos;accéder à cette section.</p>
      <LinkButton href="/" variant="secondary" className="mt-6">Retour au site</LinkButton>
    </div>
  );
}
