import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { formatMRU } from "@/lib/money";
import { query } from "@/server/db";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { adminListInvoices, INVOICE_STATUS, paymentState, PAYMENT_LABEL } from "@/server/services/invoices";
import { createManualInvoiceAction } from "../order-actions";

const tone = { draft: "slate", issued: "blue", cancelled: "red" } as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("invoices.read");
  const sp = await searchParams;
  const r = await adminListInvoices(actor, {
    q: sp.q, status: sp.statut, kind: sp.type, from: sp.du, to: sp.au, unpaid: sp.impayees === "1", page: Number(sp.page) || 1,
  });
  const canManage = can(actor.roles, "invoices.manage");
  const customers = canManage
    ? await query<{ id: string; full_name: string; business: string | null }>(
        `SELECT c.id, c.full_name, b.establishment_name AS business FROM customers c
           LEFT JOIN business_accounts b ON b.customer_id = c.id AND b.status = 'approved'
          WHERE c.status <> 'archived' AND c.anonymized_at IS NULL ORDER BY coalesce(b.establishment_name, c.full_name) LIMIT 1000`)
    : [];
  return (
    <>
      <PageHeader title="Factures et avoirs" description="Une facture émise est figée : elle se corrige par un avoir ou s'annule avec un motif." />
      {sp.supprime && <div className="mb-4"><Alert tone="success">Brouillon supprimé.</Alert></div>}
      <form className="mb-4 grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0 sm:grid-cols-3 lg:grid-cols-[1fr_9rem_9rem_9rem_9rem_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Numéro, client, commande" aria-label="Recherche" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="statut" defaultValue={sp.statut ?? ""} aria-label="Statut" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Tous statuts</option>{Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Factures et avoirs</option><option value="invoice">Factures</option><option value="credit_note">Avoirs</option>
        </select>
        <input type="date" name="du" defaultValue={sp.du} aria-label="Du" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input type="date" name="au" defaultValue={sp.au} aria-label="Au" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
      </form>
      <p className="mb-4 text-sm"><Link href="/admin/factures?impayees=1" className="font-semibold text-brand-700 underline">Factures impayées</Link></p>
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        {r.items.length === 0 ? <EmptyState title="Aucun document" /> : (
          <Table>
            <thead><tr><th className={th}>Numéro</th><th className={th}>Client</th><th className={th}>Date</th><th className={th}>Montant</th><th className={th}>Statut</th><th className={th}>Règlement</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className={td}>
                    <Link href={`/admin/factures/${i.id}`} className="font-mono font-semibold text-brand-800 hover:underline">{i.number ?? "Brouillon"}</Link>
                    <div className="text-xs text-slate-500">{i.kind === "credit_note" ? `Avoir sur ${i.credited_number}` : i.order_number ? `Commande ${i.order_number}` : "Facture manuelle"}</div>
                  </td>
                  <td className={td}>{i.buyer_business ?? i.buyer_name}</td>
                  <td className={td}>{i.issue_date?.split("-").reverse().join("/") ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatMRU(i.total_minor)}</td>
                  <td className={td}><Badge tone={tone[i.status]}>{INVOICE_STATUS[i.status]}</Badge></td>
                  <td className={td}>{PAYMENT_LABEL[paymentState(i)]}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canManage && (
          <Card className="h-fit p-5">
            <h2 className="mb-1 font-semibold">Facture manuelle</h2>
            <p className="mb-3 text-xs text-slate-500">Pour une vente hors boutique en ligne. Les factures de commande se préparent depuis la commande.</p>
            <ActionForm action={createManualInvoiceAction}>
              <Field name="customerId" label="Client" as="select" required>
                <option value="">— Choisir —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.business ? `${c.business} (${c.full_name})` : c.full_name}</option>)}
              </Field>
              <SubmitButton size="sm">Créer le brouillon</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/factures" params={{ q: sp.q, statut: sp.statut, type: sp.type, du: sp.du, au: sp.au, impayees: sp.impayees }} />
    </>
  );
}
