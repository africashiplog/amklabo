import Link from "next/link";
import { Logo } from "@/components/logo";
import { getActor } from "@/server/current";
import { can } from "@/server/permissions";
import { listPublicCategories } from "@/server/services/catalog";
import { CONTENT_PAGES, getStoreSettings } from "@/server/services/settings";
import { logoutAction } from "../actions/auth";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/catalogue", label: "Catalogue" },
  { href: "/categories", label: "Catégories" },
  { href: "/a-propos", label: "À propos" },
  { href: "/contact", label: "Contact" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [settings, actor, categories] = await Promise.all([getStoreSettings(), getActor(), listPublicCategories()]);
  const isStaff = actor ? can(actor.roles, "admin.access") : false;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Aller au contenu
      </a>
      {settings.phone && (
        <div className="bg-brand-900 text-xs text-brand-50">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5">
            <span>Livraison à {settings.city || "Nouakchott"}</span>
            <a href={`tel:${settings.phone.replace(/\s/g, "")}`} className="font-medium hover:underline">{settings.phone}</a>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="shrink-0" aria-label={`${settings.store_name} — accueil`}>
            <Logo logoPath={settings.logo_path} name={settings.store_name} className="h-10 sm:h-12" />
          </Link>
          <form action="/catalogue" role="search" className="hidden flex-1 md:block">
            <label htmlFor="q-desktop" className="sr-only">Rechercher un produit</label>
            <div className="relative mx-auto max-w-xl">
              <input id="q-desktop" name="q" type="search" placeholder="Rechercher un produit, une référence, une marque…"
                className="w-full rounded-full border border-slate-300 bg-slate-50 py-2.5 pe-24 ps-4 text-sm focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
              <button className="absolute end-1 top-1 rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">Rechercher</button>
            </div>
          </form>
          <nav className="ms-auto hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-800">{n.label}</Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2 lg:ms-0">
            {isStaff && <Link href="/admin" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 sm:inline-block">Administration</Link>}
            {actor ? (
              <Link href="/compte" className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100">Mon compte</Link>
            ) : (
              <Link href="/connexion" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">Connexion</Link>
            )}
            <details className="relative lg:hidden">
              <summary className="list-none rounded-lg p-2 text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden" aria-label="Menu">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </summary>
              <nav className="absolute end-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" aria-label="Menu mobile">
                {NAV.map((n) => <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">{n.label}</Link>)}
                {isStaff && <Link href="/admin" className="block rounded-lg px-3 py-2 text-sm font-semibold text-leaf-700 hover:bg-slate-50">Administration</Link>}
                {actor && (
                  <form action={logoutAction}><button className="w-full rounded-lg px-3 py-2 text-start text-sm text-slate-600 hover:bg-slate-50">Se déconnecter</button></form>
                )}
              </nav>
            </details>
          </div>
        </div>
        <form action="/catalogue" role="search" className="border-t border-slate-100 px-4 py-2 md:hidden">
          <label htmlFor="q-mobile" className="sr-only">Rechercher un produit</label>
          <input id="q-mobile" name="q" type="search" placeholder="Rechercher un produit…"
            className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm focus:border-brand-600 focus:outline-none" />
        </form>
      </header>

      <main id="contenu" className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo logoPath={settings.logo_path} name={settings.store_name} className="h-14" />
            <p className="mt-3 text-sm text-slate-600">Matériel médical, matériel de laboratoire et consommables médicaux en Mauritanie.</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Catégories</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {categories.filter((c) => !c.parent_id).slice(0, 6).map((c) => (
                <li key={c.id}><Link href={`/categories/${c.slug}`} className="text-slate-600 hover:text-brand-700">{c.name}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Informations</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {Object.entries(CONTENT_PAGES).map(([slug, title]) => (
                <li key={slug}><Link href={`/${slug}`} className="text-slate-600 hover:text-brand-700">{title}</Link></li>
              ))}
              <li><Link href="/contact" className="text-slate-600 hover:text-brand-700">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Nous contacter</h2>
            <address className="mt-3 space-y-1.5 text-sm not-italic text-slate-600">
              {settings.address_line && <p>{settings.address_line}</p>}
              <p>{[settings.city, settings.country].filter(Boolean).join(", ")}</p>
              {settings.phone && <p>Tél. : <a className="hover:text-brand-700" href={`tel:${settings.phone.replace(/\s/g, "")}`}>{settings.phone}</a></p>}
              {settings.whatsapp && <p>WhatsApp : {settings.whatsapp}</p>}
              {settings.email && <p><a className="hover:text-brand-700" href={`mailto:${settings.email}`}>{settings.email}</a></p>}
              {settings.opening_hours && <p>{settings.opening_hours}</p>}
            </address>
          </div>
        </div>
        <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} {settings.store_name} — {settings.tagline}
        </div>
      </footer>
    </div>
  );
}
