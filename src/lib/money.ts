/**
 * Montants en MRU stockés en unités mineures entières (1 MRU = 100).
 * Aucun calcul monétaire ne se fait en virgule flottante.
 */
export const CURRENCY = "MRU";

export function formatMRU(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const units = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const decimals = cents === 0 ? "" : "," + cents.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${grouped}${decimals} ${CURRENCY}`;
}

/** Valeur pour un champ de formulaire (ex. 125050 → "1250,50"). */
export function minorToInput(minor: number): string {
  const units = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(units) : `${units},${cents.toString().padStart(2, "0")}`;
}

/**
 * Convertit une saisie ("1 250,50", "1250.5", "1250") en unités mineures.
 * Rejette plus de 2 décimales plutôt que d'arrondir silencieusement.
 */
export function parseMRU(input: string): number | null {
  const s = input.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  const [units, dec = ""] = s.split(".");
  return Number(units) * 100 + Number(dec.padEnd(2, "0"));
}
