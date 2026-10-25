import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { listContentPages } from "@/server/services/settings";

export default async function AdminPages() {
  await requirePermissionPage("settings.manage");
  const pages = await listContentPages();
  return (
    <>
      <PageHeader title="Pages de contenu" description="Textes juridiques et informatifs. À rédiger par AMKLABO et à faire valider si nécessaire." />
      <div className="grid gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.slug} href={`/admin/pages/${p.slug}`}>
            <Card className="p-5 hover:border-brand-200">
              <p className="font-semibold text-brand-800">{p.title}</p>
              <p className="mt-1 text-xs text-slate-500">/{p.slug} · modifié le {formatDateTime(p.updated_at)}</p>
              {p.body.startsWith("[Contenu à rédiger") && <p className="mt-2 text-xs font-medium text-amber-700">Contenu non rédigé</p>}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
