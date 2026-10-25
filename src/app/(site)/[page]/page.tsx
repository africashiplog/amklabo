import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlainText } from "@/components/plain-text";
import { formatDate } from "@/lib/format";
import { CONTENT_PAGES, getContentPage, type ContentSlug } from "@/server/services/settings";

type Props = { params: Promise<{ page: string }> };

const isContentSlug = (s: string): s is ContentSlug => s in CONTENT_PAGES;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  return { title: isContentSlug(page) ? CONTENT_PAGES[page] : "Page" };
}

export default async function ContentPage({ params }: Props) {
  const { page } = await params;
  if (!isContentSlug(page)) notFound();
  const content = await getContentPage(page);
  if (!content) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{content.title}</h1>
      <p className="mt-1 text-xs text-slate-500">Dernière mise à jour : {formatDate(content.updated_at)}</p>
      <PlainText text={content.body} className="mt-6 leading-relaxed text-slate-700" />
    </article>
  );
}
