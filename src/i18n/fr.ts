export const fr = {
  productStatus: {
    draft: "Brouillon",
    published: "Publié",
    unavailable: "Indisponible",
    archived: "Archivé",
  },
  saleUnit: {
    piece: "Pièce",
    box: "Boîte",
    pack: "Paquet",
    carton: "Carton",
    lot: "Lot",
  },
  role: {
    admin: "Administrateur",
    stock_manager: "Gestionnaire de stock",
    order_manager: "Gestionnaire des commandes",
    accountant: "Comptable",
    delivery: "Livreur",
    customer_retail: "Client particulier",
    customer_business: "Client professionnel",
  },
  userStatus: {
    active: "Actif",
    suspended: "Suspendu",
    archived: "Archivé",
  },
  customerType: {
    retail: "Particulier",
    business: "Professionnel",
  },
} as const;

export const t = fr;
