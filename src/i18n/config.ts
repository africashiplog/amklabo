/**
 * Langues prises en charge. L'arabe (RTL) est prévu : ajouter "ar" ici,
 * créer le dictionnaire correspondant et la direction est appliquée
 * automatiquement sur <html dir>. Les styles utilisent des propriétés
 * logiques (ms-/me-/start/end) pour fonctionner dans les deux sens.
 */
export const LOCALES = { fr: { dir: "ltr", label: "Français" } } as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "fr";
