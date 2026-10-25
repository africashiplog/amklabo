import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { getActor } from "@/server/current";
import { getMyProfile } from "@/server/services/customer-account";
import { getStoreSettings } from "@/server/services/settings";
import { contactAction } from "../../actions/site";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ sujet?: string }> }) {
  const { sujet } = await searchParams;
  const [settings, actor] = await Promise.all([getStoreSettings(), getActor()]);
  const profile = actor ? await getMyProfile(actor) : null;
  const hasContact = settings.phone || settings.email || settings.whatsapp || settings.address_line;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">Contact</h1>
      <p className="mt-2 text-slate-600">Une question, une demande de devis ou un besoin en volume ? Écrivez-nous.</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <Card className="p-6">
          <ActionForm action={contactAction} resetOnSuccess>
            <div className="hidden" aria-hidden>
              <label>Site web <input name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <Field name="name" label="Nom ou établissement" defaultValue={profile?.full_name} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="email" label="Adresse e-mail" type="email" defaultValue={profile?.email} />
              <Field name="phone" label="Téléphone" type="tel" defaultValue={profile?.phone ?? ""} />
            </div>
            <Field name="subject" label="Objet" defaultValue={sujet?.slice(0, 150)} required />
            <Field name="message" label="Message" as="textarea" rows={6} required />
            <p className="text-xs text-slate-500">Indiquez au moins un e-mail ou un numéro de téléphone pour que nous puissions vous répondre.</p>
            <SubmitButton pendingLabel="Envoi…">Envoyer le message</SubmitButton>
          </ActionForm>
        </Card>
        <aside className="space-y-3 text-sm text-slate-700">
          <h2 className="font-semibold text-slate-900">{settings.store_name}</h2>
          {hasContact ? (
            <address className="space-y-1.5 not-italic">
              {settings.address_line && <p>{settings.address_line}</p>}
              <p>{[settings.city, settings.country].filter(Boolean).join(", ")}</p>
              {settings.phone && <p>Téléphone : {settings.phone}</p>}
              {settings.whatsapp && <p>WhatsApp : {settings.whatsapp}</p>}
              {settings.email && <p>E-mail : {settings.email}</p>}
              {settings.opening_hours && <p>Horaires : {settings.opening_hours}</p>}
            </address>
          ) : (
            <p className="text-slate-500">{[settings.city, settings.country].filter(Boolean).join(", ")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
