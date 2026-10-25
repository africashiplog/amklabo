import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireActorPage } from "@/server/current";
import { listMyNotifications } from "@/server/services/notifications";
import { markNotificationsReadAction } from "../../../actions/shop";

export const metadata: Metadata = { title: "Notifications" };

export default async function Notifications() {
  const actor = await requireActorPage("/compte/notifications");
  const items = await listMyNotifications(actor);
  const unread = items.some((n) => !n.read_at);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/compte" className="text-sm text-brand-700 hover:underline">← Mon compte</Link>
      <div className="mb-6 mt-2 flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Notifications</h1>
        {unread && <form action={markNotificationsReadAction}><button className="text-sm font-semibold text-brand-700 hover:underline">Tout marquer comme lu</button></form>}
      </div>
      {items.length === 0 ? <EmptyState title="Aucune notification" /> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`rounded-xl border p-4 ${n.read_at ? "border-slate-200 bg-white" : "border-brand-200 bg-brand-50"}`}>
              <div className="flex flex-wrap justify-between gap-2">
                {n.link ? <Link href={n.link} className="font-semibold text-brand-800 hover:underline">{n.title}</Link> : <p className="font-semibold">{n.title}</p>}
                <span className="text-xs text-slate-500">{formatDateTime(n.created_at)}</span>
              </div>
              {n.body && <p className="mt-1 text-sm text-slate-700">{n.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
