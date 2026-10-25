import Link from "next/link";
import { CustomerForm } from "@/components/customer-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePermissionPage } from "@/server/current";

export default async function NewCustomer() {
  await requirePermissionPage("customers.manage");
  return (
    <>
      <Link href="/admin/clients" className="text-sm text-brand-700 hover:underline">← Clients</Link>
      <PageHeader title="Nouveau client" description="Client sans compte en ligne (ex. commande par téléphone ou au comptoir)." />
      <Card className="max-w-2xl p-6"><CustomerForm /></Card>
    </>
  );
}
