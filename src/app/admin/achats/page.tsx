import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { listPurchaseOrders, listSuppliers, PO_STATUS } from "@/server/services/purchasing";
import { createPoAction } from "../stock-actions";

const poTone = { draft: "slate", ordered: "blue", partially_received: "amber", received: "green", cancelled: "red" } as const;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ statut?: string; fournisseur?: string }> }) {
  const actor = await requirePermissionPage("suppliers.manage");
  const sp = await searchParams;
  const [orders, suppliers] = await Promise.all([listPurchaseOrders(actor, sp.statut), listSuppliers(actor, true)]);
  const shown = sp.fournisseur ? orders.filter((o) => o.supplier_id === sp.fournisseur) : orders;
  return (
    <>
      <PageHeader title="Bons d'achat" description="Commandes d'approvisionnement auprès des fournisseurs. La réception crée les lots et met à jour le stock." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["", "Tous"], ...Object.entries(PO_STATUS)].map(([k, label]) => (
          <Link key={k} href={k ? `/admin/achats?statut=${k}` : "/admin/achats"}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${(sp.statut ?? "") === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300"}`}>{label}</Link>
        ))}
      </nav>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        {shown.length === 0 ? <EmptyState title="Aucun bon d'achat" /> : (
          <Table>
            <thead><tr><th className={th}>Numéro</th><th className={th}>Fournisseur</th><th className={th}>Lignes</th><th className={th}>Montant</th><th className={th}>Statut</th><th className={th}>Création</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className={td}><Link href={`/admin/achats/${o.id}`} className="font-mono font-medium text-brand-800 hover:underline">{o.number}</Link></td>
                  <td className={td}>{o.supplier_name}</td>
                  <td className={td}>{o.item_count}</td>
                  <td className={td}>{o.total_cost_minor != null ? formatMRU(o.total_cost_minor) : "—"}</td>
                  <td className={td}><Badge tone={poTone[o.status]}>{PO_STATUS[o.status]}</Badge></td>
                  <td className={td}>{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">Nouveau bon d&apos;achat</h2>
          {suppliers.length === 0 ? <p className="text-sm text-slate-600">Ajoutez d&apos;abord un <Link className="underline" href="/admin/fournisseurs">fournisseur</Link>.</p> : (
            <ActionForm action={createPoAction}>
              <Field name="supplierId" label="Fournisseur" as="select" defaultValue={sp.fournisseur ?? ""} required>
                <option value="">— Choisir —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Field>
              <Field name="expectedAt" label="Livraison prévue" type="date" />
              <Field name="notes" label="Notes" as="textarea" rows={2} />
              <SubmitButton size="sm">Créer le brouillon</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
