"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Le détail technique n'est jamais affiché ; il est consigné dans les journaux du serveur.
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Une erreur est survenue</h1>
      <p className="mt-2 text-slate-600">Veuillez réessayer. Si le problème persiste, contactez-nous.</p>
      <button onClick={reset} className="mt-6 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">Réessayer</button>
    </div>
  );
}
