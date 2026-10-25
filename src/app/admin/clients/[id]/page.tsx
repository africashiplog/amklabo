import Link from "next/link";
import { notFound } from "next/navigation";
import { BusinessReviewButtons } from "@/components/business-review";
import { CustomerForm } from "@/components/customer-form";
import { ActionForm, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { ProductSelect } from "@/components/product-select";
import { Alert, Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMRU } from "@/lib/money";
import { requirePermissionPage } from "@/server/current";
import { can } from "@/server/permissions";
import { ACTIVITIES, BUSINESS_STATUS, adminGetBusinessAccountForCustomer } from "@/server/services/business";
import { listProductOptions } from "@/server/services/catalog";
import { adminGetCustomer, getDeletionBlockers } from "@/server/services/customers";
import { listCustomerPrices } from "@/server/services/pricing";
import {
  addNoteAction, anonymizeCustomerAction, deleteCustomerAction, setCustomerStatusAction,
} from "../../customer-actions";
import { deleteCustomerPriceAction, setCustomerPriceAction } from "../../pricing-actions";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermissionPage("customers.read");
  const data = await adminGetCustomer(actor, id);
  if (!data) notFound();
  const { customer: c, addresses, notes } = data;
  const [business, prices, blockers] = await Promise.all([
    adminGetBusinessAccountForCustomer(actor, id), listCustomerPrices(actor, id), getDeletionBlockers(actor, id),
  ]);
  const canManage = can(actor.roles, "customers.manage") && !c.anonymized_at;
  const canPrice = can(actor.roles, "pricing.manage") && c.customer_type === "business" && !c.anonymized_at;
  const canDelete = can(actor.roles, "customers.delete");
  const products = canPrice ? await listProductOptions(actor) : [];
  const statusTone = c.status === "active" ? "green" : c.status === "suspended" ? "amber" : "slate";

  return (
    <>
      <Link href="/admin/clients" className="text-sm text-brand-700 hover:underline">← Clients</Link>
      <PageHeader title={c.full_name}
        description={<>
          <Badge tone={statusTone}>{t.userStatus[c.status]}</Badge>{" "}
          <Badge tone={c.customer_type === "business" ? "blue" : "slate"}>{t.customerType[c.customer_type]}</Badge>{" "}
          · client depuis le {formatDate(c.created_at)}
          {c.user_id ? <> · dernière connexion : {c.last_login_at ? formatDateTime(c.last_login_at) : "jamais"}</> : <> · sans compte en ligne</>}
        </>} />
      {c.anonymized_at && <div className="mb-4"><Alert tone="warning">Données personnelles anonymisées le {formatDateTime(c.anonymized_at)}.</Alert></div>}
      {c.is_staff && <div className="mb-4"><Alert tone="info">Ce client est aussi membre du personnel : son compte se gère dans « Utilisateurs et rôles ».</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 font-semibold">Coordonnées</h2>
            {canManage ? <CustomerForm customer={c} /> : (
              <dl className="space-y-1 text-sm"><div>E-mail : {c.email ?? "—"}</div><div>Téléphone : {c.phone ?? "—"}</div></dl>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Compte professionnel</h2>
            {!business ? <p className="text-sm text-slate-600">Aucune demande de compte professionnel.</p> : (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{business.establishment_name} <Badge tone={business.status === "approved" ? "green" : business.status === "pending" ? "amber" : "red"}>{BUSINESS_STATUS[business.status]}</Badge></p>
                <p className="text-slate-600">{ACTIVITIES[business.activity]} · {business.contact_name} · {business.phone} · {business.address_line}, {business.city}</p>
                <p className="text-slate-600">Identifiant professionnel : {business.professional_id ?? "non fourni"}</p>
                {business.reviewed_at && <p className="text-xs text-slate-500">Décision du {formatDateTime(business.reviewed_at)} par {business.reviewer_name ?? "—"}{business.decision_reason ? ` — ${business.decision_reason}` : ""}</p>}
                {can(actor.roles, "business.approve") && !c.anonymized_at && <BusinessReviewButtons id={business.id} status={business.status} name={business.establishment_name} />}
              </div>
            )}
          </Card>

          {(c.customer_type === "business" || prices.length > 0) && (
            <Card className="space-y-4 p-6">
              <div>
                <h2 className="font-semibold">Prix négociés</h2>
                <p className="text-xs text-slate-500">Prioritaires sur tous les autres tarifs, appliqués uniquement si le compte professionnel est approuvé{business?.status !== "approved" && " — ce n'est pas le cas actuellement"}.</p>
              </div>
              {prices.length > 0 && (
                <Table>
                  <thead><tr><th className={th}>Produit</th><th className={th}>Dès</th><th className={th}>Prix</th><th className={th}>Validité</th><th className={th}></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {prices.map((p) => (
                      <tr key={p.id}>
                        <td className={td}>{p.product_name}<div className="font-mono text-xs text-slate-400">{p.sku}</div></td>
                        <td className={td}>{p.min_qty}</td>
                        <td className={td}><strong>{formatMRU(p.unit_price_minor)}</strong><div className="text-xs text-slate-400">public : {formatMRU(p.retail_price_minor)}</div></td>
                        <td className={`${td} text-xs`}>{p.valid_from ?? "…"} → {p.valid_to ?? "…"}{p.note && <div className="text-slate-500">{p.note}</div>}</td>
                        <td className={td}>{canPrice && <ConfirmAction action={deleteCustomerPriceAction} fields={{ id: p.id }} label="Retirer"
                          title="Retirer ce prix négocié ?" description={`${p.product_name} : le client paiera de nouveau le meilleur tarif standard.`} confirmLabel="Retirer" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {canPrice && (
                <ActionForm action={setCustomerPriceAction} resetOnSuccess>
                  <input type="hidden" name="customerId" value={c.id} />
                  <ProductSelect products={products} />
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field name="unitPrice" label="Prix unitaire (MRU)" inputMode="decimal" required />
                    <Field name="minQty" label="Dès (quantité)" type="number" min={1} defaultValue={1} />
                    <Field name="validFrom" label="Du" type="date" />
                    <Field name="validTo" label="Au" type="date" />
                  </div>
                  <Field name="note" label="Note" hint="(ex. référence du contrat)" />
                  <SubmitButton size="sm">Enregistrer le prix</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Adresses</h2>
            {addresses.length === 0 ? <p className="text-sm text-slate-600">Aucune adresse.</p> : (
              <ul className="space-y-2 text-sm">
                {addresses.map((a) => (
                  <li key={a.id}><strong>{a.label}</strong>{a.is_default && " (par défaut)"} — {a.recipient}, {a.phone}, {a.line1}{a.district ? `, ${a.district}` : ""}, {a.city}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-1 font-semibold">Commandes, factures et paiements</h2>
            <p className="text-sm text-slate-600">L&apos;historique apparaîtra ici avec les modules de commande et de facturation (Phase 3).</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Notes internes</h2>
            <p className="text-xs text-slate-500">Jamais visibles par le client. Les notes ne peuvent pas être modifiées après ajout.</p>
            {canManage && (
              <ActionForm action={addNoteAction} resetOnSuccess>
                <input type="hidden" name="customerId" value={c.id} />
                <Field name="body" label="Nouvelle note" as="textarea" rows={3} required />
                <SubmitButton size="sm" variant="secondary">Ajouter</SubmitButton>
              </ActionForm>
            )}
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-500">{n.author ?? "—"} · {formatDateTime(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </Card>

          {canManage && !c.is_staff && (
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">Statut du compte</h2>
              <div className="flex flex-wrap gap-2">
                {c.status !== "active" && (
                  <ConfirmAction action={setCustomerStatusAction} fields={{ id: c.id, status: "active" }} label="Réactiver" variant="success"
                    title={`Réactiver ${c.full_name} ?`} description="Le client pourra de nouveau se connecter." confirmLabel="Réactiver" />
                )}
                {c.status === "active" && (
                  <ConfirmAction action={setCustomerStatusAction} fields={{ id: c.id, status: "suspended" }} label="Suspendre"
                    title={`Suspendre ${c.full_name} ?`} confirmLabel="Suspendre"
                    description="Le client ne pourra plus se connecter et ses sessions seront fermées. Ses tarifs professionnels cessent de s'appliquer. Ses données sont conservées ; l'opération est réversible." />
                )}
                {c.status !== "archived" && (
                  <ConfirmAction action={setCustomerStatusAction} fields={{ id: c.id, status: "archived" }} label="Archiver"
                    title={`Archiver ${c.full_name} ?`} confirmLabel="Archiver"
                    description="Le client disparaît des listes courantes et ne peut plus se connecter. Tout son historique est conservé. Réversible." />
                )}
              </div>
            </Card>
          )}

          {canDelete && c.status === "archived" && !c.anonymized_at && !c.is_staff && (
            <Card className="space-y-3 border-red-200 p-5">
              <h2 className="font-semibold text-red-700">Données personnelles</h2>
              {blockers.length === 0 ? (
                <ConfirmAction action={deleteCustomerAction} fields={{ id: c.id }} label="Supprimer définitivement"
                  title={`Supprimer définitivement ${c.full_name} ?`} confirmLabel="Supprimer définitivement"
                  description={<>La fiche client, {c.user_id ? "son compte de connexion, " : ""}ses {addresses.length} adresse(s) et ses notes seront supprimés. Aucun historique de vente n&apos;est concerné. Cette action est <strong>irréversible</strong> ; une trace sans données personnelles reste dans le journal d&apos;audit.</>} />
              ) : (
                <p className="text-sm text-slate-600">Suppression impossible : {blockers.join(", ")}. L&apos;historique doit être conservé.</p>
              )}
              <ConfirmAction action={anonymizeCustomerAction} fields={{ id: c.id }} label="Anonymiser"
                title={`Anonymiser ${c.full_name} ?`} confirmLabel="Anonymiser"
                description="Le nom, l'e-mail, le téléphone et les adresses seront effacés ; le compte de connexion sera désactivé. Les enregistrements nécessaires à l'historique sont conservés. Irréversible." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
