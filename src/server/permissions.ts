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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Principe du moindre privilège. Les permissions financières, stock,
// commandes et livraisons seront ajoutées avec les modules correspondants.
const MATRIX: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  stock_manager: ["admin.access", "dashboard.view", "catalog.manage"],
  order_manager: ["admin.access", "dashboard.view", "customers.read", "messages.manage"],
  accountant: ["admin.access", "dashboard.view", "customers.read"],
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
