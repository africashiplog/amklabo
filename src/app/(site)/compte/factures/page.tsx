import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, Table, td, th } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { requireActorPage } from "@/server/current";
import { listMyInvoices, paymentState, PAYMENT_LABEL } from "@/server/services/invoices";

export const metadata: Metadata = { title: "Mes factures" };

export default async function MyInvoices() {
  const actor = await requireActorPage("/compte/factures");
  const invoices = await listMyInvoices(actor);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/compte" className="text-sm text-brand-700 hover:underline">← Mon compte</Link>
      <h1 className="mb-6 mt-2 text-3xl font-bold">Mes factures</h1>
      {invoices.length === 0 ? <EmptyState title="Aucune facture" /> : (
        <Table>
          <thead><tr><th className={th}>Document</th><th className={th}>Date</th><th className={th}>Commande</th><th className={th}>Montant</th><th className={th}>Règlement</th><th className={th}></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className={td}><span className="font-mono font-semibold">{i.number}</span><div className="text-xs text-slate-500">{i.kind === "credit_note" ? `Avoir sur ${i.credited_number}` : "Facture"}</div></td>
                <td className={td}>{i.issue_date?.split("-").reverse().join("/")}</td>
                <td className={td}>{i.order_number ? <Link className="underline" href={`/compte/commandes/${i.order_number}`}>{i.order_number}</Link> : "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{formatMRU(i.total_minor)}</td>
                <td className={td}>{i.status === "cancelled" ? <Badge tone="red">Annulée</Badge> : PAYMENT_LABEL[paymentState(i)]}</td>
                <td className={td}><a href={`/factures/${i.id}/pdf`} target="_blank" className="font-semibold text-brand-700 underline">PDF</a></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
