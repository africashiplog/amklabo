import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-leaf-700">Erreur 404</p>
      <h1 className="mt-2 text-3xl font-bold">Page introuvable</h1>
      <p className="mt-2 text-slate-600">La page demandée n&apos;existe pas ou n&apos;est plus disponible.</p>
      <LinkButton href="/catalogue" className="mt-6">Voir le catalogue</LinkButton>
    </div>
  );
}
