import Link from "next/link";
import { InlineAction } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { listContactMessages } from "@/server/services/contact";
import { markHandledAction } from "../actions";

export default async function AdminMessages({ searchParams }: { searchParams: Promise<{ tous?: string }> }) {
  const actor = await requirePermissionPage("messages.manage");
  const all = !!(await searchParams).tous;
  const messages = await listContactMessages(actor, !all);
  return (
    <>
      <PageHeader title="Messages de contact"
        description="Messages envoyés depuis le formulaire de contact. Aucune notification e-mail n'est configurée : consultez cette page régulièrement."
        actions={<Link href={all ? "/admin/messages" : "/admin/messages?tous=1"} className="text-sm font-semibold text-brand-700 hover:underline">{all ? "Afficher les messages à traiter" : "Afficher tous les messages"}</Link>} />
      {messages.length === 0 ? <EmptyState title="Aucun message à traiter" /> : (
        <ul className="space-y-4">
          {messages.map((m) => (
            <li key={m.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{m.subject}</p>
                    <p className="text-sm text-slate-600">{m.name} · {m.email ?? "—"} · {m.phone ?? "—"}</p>
                  </div>
                  <div className="text-end text-xs text-slate-500">
                    <p>{formatDateTime(m.created_at)}</p>
                    {m.handled_at ? <Badge tone="green">Traité par {m.handled_by_name ?? "—"}</Badge> : <Badge tone="amber">À traiter</Badge>}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{m.message}</p>
                {!m.handled_at && <div className="mt-3"><InlineAction action={markHandledAction} fields={{ id: m.id }} variant="success">Marquer comme traité</InlineAction></div>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
