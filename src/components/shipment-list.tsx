import Link from "next/link";
import { DeliveryBadge } from "./delivery-badge";
import { EmptyState, Table, td, th } from "./ui";
import type { ShipmentRow } from "@/server/services/deliveries";

export function ShipmentList({ rows, showDriver }: { rows: ShipmentRow[]; showDriver: boolean }) {
  if (rows.length === 0) return <EmptyState title="Aucune livraison" />;
  return (
    <Table>
      <thead><tr><th className={th}>Commande</th><th className={th}>Destinataire</th><th className={th}>Adresse</th>{showDriver && <th className={th}>Livreur</th>}<th className={th}>Prévue</th><th className={th}>Statut</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((s) => (
          <tr key={s.id} className="hover:bg-slate-50">
            <td className={td}><Link href={`/admin/livraisons/${s.id}`} className="font-mono font-semibold text-brand-800 hover:underline">{s.order_number}</Link></td>
            <td className={td}>{s.ship_recipient}<div className="text-xs text-slate-500">{s.ship_phone}</div></td>
            <td className={td}>{s.ship_line1}{s.ship_district ? `, ${s.ship_district}` : ""}<div className="text-xs text-slate-500">{s.zone_name}</div></td>
            {showDriver && <td className={td}>{s.driver_name ?? s.carrier_name ?? "—"}</td>}
            <td className={td}>{s.scheduled_for?.split("-").reverse().join("/") ?? "—"}</td>
            <td className={td}><DeliveryBadge status={s.status} />{s.payment_method_code === "cash_on_delivery" && <div className="mt-1 text-xs text-amber-700">À encaisser</div>}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
