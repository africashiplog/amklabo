import type { Actor } from "../actor";
import type { ProductRow } from "./catalog";
import { getPriceContext, quoteLines, type PriceQuote } from "./pricing";
import { getAvailability } from "./stock";

/**
 * Prix (calculés côté serveur pour le client connecté, à la quantité minimale
 * de commande) et disponibilité, pour l'affichage d'une liste de produits.
 */
export async function enrichProducts(actor: Actor | null, products: ProductRow[]) {
  const ctx = await getPriceContext(actor);
  const ids = products.map((p) => p.id);
  const [quotes, stock] = await Promise.all([
    quoteLines(ctx, products.map((p) => ({ productId: p.id, quantity: p.min_order_qty }))),
    getAvailability(ids),
  ]);
  const prices = new Map<string, PriceQuote>(quotes.map((q) => [q.productId, q]));
  return { prices, stock };
}
