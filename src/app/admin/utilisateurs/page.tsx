import Link from "next/link";
import { ActionForm, Checkbox, ConfirmAction, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader, Pagination } from "@/components/ui";
import { t } from "@/i18n/fr";
import { formatDateTime } from "@/lib/format";
import { requirePermissionPage } from "@/server/current";
import { STAFF_ROLES } from "@/server/permissions";
import { adminListUsers } from "@/server/services/users";
import { createStaffAction, resetPasswordAction, setRolesAction, setUserStatusAction } from "../actions";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermissionPage("users.manage");
  const sp = await searchParams;
  const scope = sp.tous ? "all" : "staff";
  const r = await adminListUsers(actor, { q: sp.q, scope, page: Number(sp.page) || 1 });

  return (
    <>
      <PageHeader title="Utilisateurs et rôles"
        description="Chaque rôle n'accède qu'aux fonctions nécessaires ; les droits sont vérifiés côté serveur à chaque opération." />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div>
          <form className="mb-4 flex flex-wrap gap-2">
            <input name="q" defaultValue={sp.q} placeholder="Nom, e-mail, téléphone" aria-label="Recherche" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="tous" value="1" defaultChecked={!!sp.tous} /> Inclure les clients</label>
            <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Filtrer</button>
          </form>
          <ul className="space-y-4">
            {r.items.map((u) => {
              const self = u.id === actor.id;
              return (
                <li key={u.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{u.full_name} {self && <span className="text-xs text-slate-500">(vous)</span>}</p>
                        <p className="text-sm text-slate-600">{u.email}{u.phone ? ` · ${u.phone}` : ""}</p>
                        <p className="text-xs text-slate-500">Dernière connexion : {u.last_login_at ? formatDateTime(u.last_login_at) : "jamais"}</p>
                      </div>
                      <Badge tone={u.status === "active" ? "green" : "amber"}>{t.userStatus[u.status]}</Badge>
                    </div>
                    <ActionForm action={setRolesAction} className="mt-4" showSuccess>
                      <input type="hidden" name="userId" value={u.id} />
                      <fieldset>
                        <legend className="mb-2 text-sm font-medium text-slate-700">Rôles du personnel</legend>
                        <div className="grid gap-1 sm:grid-cols-3">
                          {STAFF_ROLES.map((role) => (
                            <Checkbox key={role} name="roles" value={role} label={t.role[role]} defaultChecked={u.roles.includes(role)} />
                          ))}
                        </div>
                      </fieldset>
                      {u.roles.filter((x) => x.startsWith("customer")).map((x) => <Badge key={x} tone="blue">{t.role[x]}</Badge>)}
                      <SubmitButton size="sm" variant="secondary">Enregistrer les rôles</SubmitButton>
                    </ActionForm>
                    {!self && u.status !== "archived" && (
                      <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-3">
                        <ConfirmAction action={resetPasswordAction} fields={{ userId: u.id }} label="Réinitialiser le mot de passe" variant="secondary"
                          title={`Réinitialiser le mot de passe de ${u.full_name} ?`} confirmLabel="Générer un mot de passe temporaire"
                          description={<>Un mot de passe temporaire sera affiché une seule fois sous le bouton. Toutes les sessions de <strong>{u.email}</strong> seront fermées. Vérifiez l&apos;identité de la personne avant de le lui transmettre.</>} />
                        {u.status === "active" ? (
                          <ConfirmAction action={setUserStatusAction} fields={{ userId: u.id, status: "suspended" }} label="Suspendre le compte"
                            title={`Suspendre le compte de ${u.full_name} ?`}
                            description={<>Le compte <strong>{u.email}</strong> ne pourra plus se connecter et toutes ses sessions seront fermées immédiatement. Ses données et son historique sont conservés. L&apos;opération est réversible et enregistrée dans le journal d&apos;audit.</>}
                            confirmLabel="Suspendre" />
                        ) : (
                          <ConfirmAction action={setUserStatusAction} fields={{ userId: u.id, status: "active" }} label="Réactiver le compte" variant="success"
                            title={`Réactiver le compte de ${u.full_name} ?`} description={<>Le compte <strong>{u.email}</strong> pourra de nouveau se connecter.</>} confirmLabel="Réactiver" />
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
          <Pagination page={r.page} pageCount={r.pageCount} basePath="/admin/utilisateurs" params={{ q: sp.q, tous: sp.tous }} />
        </div>
        <Card className="h-fit p-5">
          <h2 className="mb-1 font-semibold">Nouveau membre du personnel</h2>
          <p className="mb-4 text-xs text-slate-500">Un mot de passe temporaire est généré et affiché une seule fois. Demandez à la personne de le changer dès sa première connexion.</p>
          <ActionForm action={createStaffAction} resetOnSuccess>
            <Field name="fullName" label="Nom complet" required />
            <Field name="email" label="E-mail" type="email" required />
            <Field name="phone" label="Téléphone" />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Rôles</legend>
              <div className="space-y-1">{STAFF_ROLES.map((role) => <Checkbox key={role} name="roles" value={role} label={t.role[role]} />)}</div>
            </fieldset>
            <SubmitButton>Créer le compte</SubmitButton>
          </ActionForm>
          <p className="mt-4 text-xs text-slate-500"><Link href="/admin/journal?action=user." className="underline">Historique des modifications de comptes</Link></p>
        </Card>
      </div>
    </>
  );
}
