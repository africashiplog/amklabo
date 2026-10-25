import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { CONTENT_PAGES, getContentPage, type ContentSlug } from "@/server/services/settings";
import { saveContentPageAction } from "../../actions";

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
