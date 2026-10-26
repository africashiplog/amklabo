import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { CONTENT_PAGES, getContentPage, type ContentSlug } from "@/server/services/settings";
import { mediaUrl } from "@/server/storage";
import { removeContentPdfAction, saveContentPageAction, uploadContentPdfAction } from "../../actions";

export default async function EditContentPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermissionPage("settings.manage");
  const { slug } = await params;
  if (!(slug in CONTENT_PAGES)) notFound();
  const page = await getContentPage(slug as ContentSlug);
  if (!page) notFound();
  return (
    <>
      <Link href="/admin/pages" className="text-sm text-brand-700 hover:underline">← Pages de contenu</Link>
      <PageHeader title={page.title} description="Texte simple : séparez les paragraphes par une ligne vide." />
      <Card className="mb-6 space-y-3 p-6">
        <h2 className="font-semibold">Document officiel (PDF)</h2>
        <p className="text-sm text-slate-600">Le PDF validé est proposé au téléchargement sur la page publique, au-dessus du texte. Le texte ci-dessous reste affiché comme résumé (facultatif).</p>
        {page.pdf_path ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href={mediaUrl(page.pdf_path)} target="_blank" rel="noopener" className="font-semibold text-brand-700 underline">Voir le PDF publié</a>
            <ConfirmAction action={removeContentPdfAction} fields={{ slug }} label="Retirer le PDF" title="Retirer le document PDF ?"
              confirmLabel="Retirer" description="Le document ne sera plus téléchargeable sur le site." />
          </div>
        ) : <p className="text-sm text-amber-800">Aucun PDF publié pour cette page.</p>}
        <ActionForm action={uploadContentPdfAction} resetOnSuccess>
          <input type="hidden" name="slug" value={slug} />
          <Field name="pdf" label={page.pdf_path ? "Remplacer le PDF" : "Téléverser le PDF"} hint="(PDF, 5 Mo max)" type="file" accept="application/pdf" required />
          <SubmitButton variant="secondary" pendingLabel="Envoi…">Publier le PDF</SubmitButton>
        </ActionForm>
      </Card>
      <Card className="p-6">
        <ActionForm action={saveContentPageAction}>
          <input type="hidden" name="slug" value={slug} />
          <Field name="title" label="Titre" defaultValue={page.title} required />
          <Field name="body" label="Contenu" as="textarea" rows={20} defaultValue={page.body} />
          <SubmitButton>Enregistrer</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
