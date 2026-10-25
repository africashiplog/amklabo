export const ROLES = [
  "admin",
  "stock_manager",
  "order_manager",
  "accountant",
  "delivery",
  "customer_retail",
  "customer_business",
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["admin", "stock_manager", "order_manager", "accountant", "delivery"];

export const PERMISSIONS = [
  "admin.access",       // accès à l'espace d'administration
  "dashboard.view",
  "catalog.manage",     // catégories, produits, images
  "customers.read",
  "settings.manage",    // paramètres du magasin, pages, zones de livraison
  "users.manage",       // comptes du personnel et rôles
  "audit.read",
  "messages.manage",    // messages du formulaire de contact
  "pricing.manage",     // prix de détail, paliers, prix clients, promotions
  "customers.manage",   // fiches clients, notes internes, suspension, archivage
  "customers.delete",   // suppression et anonymisation des données personnelles
  "business.approve",   // approbation des comptes professionnels
  "stock.manage",       // lots, entrées, sorties, ajustements
  "suppliers.manage",   // fournisseurs et bons d'achat
  "stock.view_costs",   // coûts d'achat
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Principe du moindre privilège. Les permissions commandes, factures,
// paiements et livraisons seront ajoutées avec les modules correspondants.
// Le gestionnaire de stock gère le catalogue mais pas les prix : un produit
// qu'il crée reste en brouillon sans prix jusqu'à validation par un administrateur.
const MATRIX: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  stock_manager: ["admin.access", "dashboard.view", "catalog.manage", "stock.manage", "suppliers.manage", "stock.view_costs"],
  order_manager: ["admin.access", "dashboard.view", "customers.read", "customers.manage", "messages.manage"],
  accountant: ["admin.access", "dashboard.view", "customers.read", "stock.view_costs"],
  delivery: ["admin.access"],
  customer_retail: [],
  customer_business: [],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) for (const p of MATRIX[role] ?? []) set.add(p);
  return set;
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}
