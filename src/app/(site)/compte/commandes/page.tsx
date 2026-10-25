import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/order-badges";
import { EmptyState, Table, td, th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { listMyOrders } from "@/server/services/orders";

export const metadata: Metadata = { title: "Mes commandes" };

export default async function MyOrders() {
  const actor = await requireActorPage("/compte/commandes");
  const orders = await listMyOrders(actor).catch(() => []);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/compte" className="text-sm text-brand-700 hover:underline">← Mon compte</Link>
      <h1 className="mb-6 mt-2 text-3xl font-bold">Mes commandes</h1>
      {orders.length === 0 ? <EmptyState title="Aucune commande"><Link href="/catalogue" className="underline">Parcourir le catalogue</Link></EmptyState> : (
        <Table>
          <thead><tr><th className={th}>Numéro</th><th className={th}>Date</th><th className={th}>Articles</th><th className={th}>Total</th><th className={th}>Statut</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className={td}><Link href={`/compte/commandes/${o.number}`} className="font-mono font-semibold text-brand-800 hover:underline">{o.number}</Link></td>
                <td className={td}>{formatDate(o.placed_at)}</td>
                <td className={td}>{o.item_count}</td>
                <td className={`${td} whitespace-nowrap`}>{formatMRU(o.total_minor)}</td>
                <td className={td}><OrderStatusBadge status={o.status} />{o.cancel_requested_at && <div className="mt-1 text-xs text-amber-700">Annulation demandée</div>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
