import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressForm } from "@/components/address-form";
import { Card } from "@/components/ui";
import { requireActorPage } from "@/server/current";
import { listMyAddresses } from "@/server/services/customer-account";
import { listActiveZones } from "@/server/services/zones";

export default async function EditAddressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActorPage(`/compte/adresses/${id}`);
  // Seules les adresses du client connecté sont chargées.
  const address = (await listMyAddresses(actor)).find((a) => a.id === id);
  if (!address) notFound();
  const zones = await listActiveZones();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/compte#adresses" className="text-sm text-brand-700 hover:underline">← Mon compte</Link>
      <h1 className="mt-2 text-2xl font-bold">Modifier l&apos;adresse</h1>
      <Card className="mt-6 p-6"><AddressForm address={address} zones={zones} /></Card>
    </div>
  );
}
