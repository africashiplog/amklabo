import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { requirePermissionPage } from "@/server/current";
import { can, type Permission } from "@/server/permissions";
import { getStoreSettings } from "@/server/services/settings";
import { t } from "@/i18n/fr";
import { logoutAction } from "../actions/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Administration", template: "%s · Administration AMKLABO" }, robots: { index: false } };

const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin", label: "Tableau de bord", permission: "dashboard.view" },
  { href: "/admin/rapports", label: "Rapports", permission: "reports.view" },
  { href: "/admin/commandes", label: "Commandes", permission: "orders.read" },
  { href: "/admin/factures", label: "Factures et avoirs", permission: "invoices.read" },
  { href: "/admin/paiements", label: "Paiements", permission: "payments.view" },
  { href: "/admin/livraisons", label: "Livraisons", permission: "deliveries.manage" },
  { href: "/admin/livraisons/mes", label: "Mes livraisons", permission: "deliveries.own" },
  { href: "/admin/produits", label: "Produits", permission: "catalog.manage" },
  { href: "/admin/categories", label: "Catégories", permission: "catalog.manage" },
  { href: "/admin/promotions", label: "Promotions", permission: "pricing.manage" },
  { href: "/admin/stock", label: "Stock", permission: "stock.manage" },
  { href: "/admin/stock/peremptions", label: "Péremptions", permission: "stock.manage" },
  { href: "/admin/achats", label: "Bons d'achat", permission: "suppliers.manage" },
  { href: "/admin/fournisseurs", label: "Fournisseurs", permission: "suppliers.manage" },
  { href: "/admin/clients", label: "Clients", permission: "customers.read" },
  { href: "/admin/professionnels", label: "Comptes professionnels", permission: "customers.read" },
  { href: "/admin/messages", label: "Messages", permission: "messages.manage" },
  { href: "/admin/livraison", label: "Zones de livraison", permission: "settings.manage" },
  { href: "/admin/moyens-de-paiement", label: "Moyens de paiement", permission: "settings.manage" },
  { href: "/admin/pages", label: "Pages de contenu", permission: "settings.manage" },
  { href: "/admin/parametres", label: "Paramètres du magasin", permission: "settings.manage" },
  { href: "/admin/utilisateurs", label: "Utilisateurs et rôles", permission: "users.manage" },
  { href: "/admin/journal", label: "Journal d'audit", permission: "audit.read" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePermissionPage("admin.access");
  const settings = await getStoreSettings();
  // « Mes livraisons » ne concerne que les livreurs (les gestionnaires voient toutes les livraisons).
  const links = NAV.filter((n) => can(actor.roles, n.permission))
    .filter((n) => n.href !== "/admin/livraisons/mes" || !can(actor.roles, "deliveries.manage"));
  const roleLabel = actor.roles.filter((r) => !r.startsWith("customer")).map((r) => t.role[r]).join(", ");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-slate-200 bg-white print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between gap-2 p-4 lg:block">
          <Link href="/admin"><Logo logoPath={settings.logo_path} name={settings.store_name} className="h-10 lg:h-12" /></Link>
          <div className="flex items-center gap-3 lg:block">
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-700 lg:mt-2">Administration</p>
            <form action={logoutAction} className="lg:hidden"><button className="text-xs text-slate-600 underline">Déconnexion</button></form>
          </div>
        </div>
        <nav aria-label="Administration" className="flex gap-1 overflow-x-auto px-2 pb-3 lg:block lg:min-h-0 lg:flex-1 lg:space-y-0.5 lg:overflow-y-auto lg:overflow-x-visible">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="block shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-800">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-slate-100 p-4 text-xs text-slate-500 lg:block">
          <p className="font-medium text-slate-700">{actor.fullName}</p>
          <p>{roleLabel}</p>
          <div className="mt-2 flex gap-3">
            <Link href="/" className="text-brand-700 hover:underline">Voir le site</Link>
            <form action={logoutAction}><button className="text-slate-600 hover:underline">Déconnexion</button></form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
