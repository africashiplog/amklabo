import Link from "next/link";
import { SupplierForm } from "@/components/supplier-form";
import { Badge, Card, EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";
import { listSuppliers } from "@/server/services/purchasing";

export default async function SuppliersPage() {
  const actor = await requirePermissionPage("suppliers.manage");
  const suppliers = await listSuppliers(actor);
  return (
    <>
      <PageHeader title="Fournisseurs" />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        {suppliers.length === 0 ? <EmptyState title="Aucun fournisseur" /> : (
          <Table>
            <thead><tr><th className={th}>Nom</th><th className={th}>Contact</th><th className={th}>Produits</th><th className={th}>Bons d&apos;achat</th><th className={th}>État</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className={td}><Link href={`/admin/fournisseurs/${s.id}`} className="font-medium text-brand-800 hover:underline">{s.name}</Link><div className="text-xs text-slate-400">{s.country}</div></td>
                  <td className={td}>{s.contact_name ?? "—"}<div className="text-xs text-slate-500">{[s.phone, s.email].filter(Boolean).join(" · ")}</div></td>
                  <td className={td}>{s.product_count}</td>
                  <td className={td}>{s.po_count}</td>
                  <td className={td}>{s.is_active ? <Badge tone="green">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Card className="h-fit p-5"><h2 className="mb-4 font-semibold">Nouveau fournisseur</h2><SupplierForm /></Card>
      </div>
    </>
  );
}
