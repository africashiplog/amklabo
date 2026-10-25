import Link from "next/link";
import { Badge, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { listExpiringLots } from "@/server/services/stock";

export default async function ExpiryPage() {
  const actor = await requirePermissionPage("stock.manage");
  const lots = await listExpiringLots(actor);
  return (
    <>
      <PageHeader title="Péremptions" description="Lots en stock périmés ou arrivant à péremption dans le délai d'alerte. Les lots périmés ne sont jamais proposés à la vente." />
      {lots.length === 0 ? <EmptyState title="Aucun lot proche de la péremption" /> : (
        <Table>
          <thead><tr><th className={th}>Produit</th><th className={th}>Lot</th><th className={th}>Péremption</th><th className={th}>Quantité</th><th className={th}>Échéance</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lots.map((l) => (
              <tr key={l.lot_id}>
                <td className={td}><Link href={`/admin/stock/${l.product_id}`} className="font-medium text-brand-800 hover:underline">{l.product_name}</Link><div className="font-mono text-xs text-slate-400">{l.sku}</div></td>
                <td className={`${td} font-mono text-xs`}>{l.lot_number ?? "—"}</td>
                <td className={td}>{l.expiry_date}</td>
                <td className={`${td} font-semibold`}>{l.qty_on_hand}</td>
                <td className={td}>{l.days_left < 0 ? <Badge tone="red">Périmé depuis {-l.days_left} j</Badge> : l.days_left <= 30 ? <Badge tone="red">{l.days_left} j</Badge> : <Badge tone="amber">{l.days_left} j</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
