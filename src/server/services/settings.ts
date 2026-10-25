import { z } from "../validation";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { query, queryOne, tx } from "../db";
import { UserError } from "../errors";
import { deleteStoredFile, saveImage } from "../storage";

export type StoreSettings = {
  store_name: string;
  tagline: string;
  logo_path: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address_line: string | null;
  city: string | null;
  country: string;
  currency: string;
  opening_hours: string | null;
  legal_name: string | null;
  tax_id: string | null;
  trade_register: string | null;
  bank_details: string | null;
  invoice_footer: string | null;
  expiry_alert_days: number;
};

export const DEFAULT_LOGO = "/brand/logo.png";

export async function getStoreSettings(): Promise<StoreSettings> {
  const row = await queryOne<StoreSettings>("SELECT * FROM store_settings WHERE id = 1");
  if (!row) throw new Error("store_settings non initialisé : exécutez npm run db:seed");
  return row;
}

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const settingsSchema = z.object({
  storeName: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(120),
  email: z.string().trim().email("Adresse e-mail invalide").max(200).optional().or(z.literal("")).transform((v) => v || null),
  phone: opt(40),
  whatsapp: opt(40),
  addressLine: opt(300),
  city: opt(80),
  openingHours: opt(300),
  legalName: opt(200),
  taxId: opt(80),
  tradeRegister: opt(80),
  bankDetails: opt(1000),
  invoiceFooter: opt(1000),
  expiryAlertDays: z.union([z.number(), z.string().trim()]).pipe(z.coerce.number().int("Nombre entier attendu").min(1, "Minimum 1").max(730, "Maximum 730")),
});

export async function updateStoreSettings(actor: Actor | null, input: z.input<typeof settingsSchema>) {
  assertCan(actor, "settings.manage");
  const d = settingsSchema.parse(input);
  await tx(async (db) => {
    const before = await queryOne("SELECT * FROM store_settings WHERE id = 1 FOR UPDATE", [], db);
    const after = await queryOne(
      `UPDATE store_settings SET store_name=$1, tagline=$2, email=$3, phone=$4, whatsapp=$5, address_line=$6,
              city=$7, opening_hours=$8, legal_name=$9, tax_id=$10, trade_register=$11, bank_details=$12,
              invoice_footer=$13, updated_by=$14, expiry_alert_days=$15
        WHERE id = 1 RETURNING *`,
      [d.storeName, d.tagline, d.email, d.phone, d.whatsapp, d.addressLine, d.city, d.openingHours,
       d.legalName, d.taxId, d.tradeRegister, d.bankDetails, d.invoiceFooter, actor.id, d.expiryAlertDays],
      db,
    );
    await audit(actor, "settings.update", "store_settings", "1", { before, after }, db);
  });
}

/** Remplace le logo. Le logo d'origine reste disponible dans /public/brand. */
export async function replaceLogo(actor: Actor | null, file: File) {
  assertCan(actor, "settings.manage");
  const path = await saveImage(file, "brand");
  const before = await queryOne<{ logo_path: string | null }>("SELECT logo_path FROM store_settings WHERE id = 1");
  await query("UPDATE store_settings SET logo_path = $1, updated_by = $2 WHERE id = 1", [path, actor.id]);
  await audit(actor, "settings.logo_replace", "store_settings", "1", { before, after: { logo_path: path } });
  if (before?.logo_path) await deleteStoredFile(before.logo_path);
}

export async function resetLogo(actor: Actor | null) {
  assertCan(actor, "settings.manage");
  const before = await queryOne<{ logo_path: string | null }>("SELECT logo_path FROM store_settings WHERE id = 1");
  await query("UPDATE store_settings SET logo_path = NULL, updated_by = $1 WHERE id = 1", [actor.id]);
  await audit(actor, "settings.logo_reset", "store_settings", "1", { before, after: { logo_path: null } });
  if (before?.logo_path) await deleteStoredFile(before.logo_path);
}

// ---------------------------------------------------------------------------
// Pages de contenu (à propos, conditions, confidentialité, livraison)
// ---------------------------------------------------------------------------
export const CONTENT_PAGES = {
  "a-propos": "À propos",
  "conditions-generales": "Conditions générales de vente",
  confidentialite: "Politique de confidentialité",
  "livraison-retours": "Livraison et retours",
} as const;
export type ContentSlug = keyof typeof CONTENT_PAGES;

export type ContentPage = { slug: string; title: string; body: string; updated_at: Date };

export async function getContentPage(slug: ContentSlug) {
  return queryOne<ContentPage>("SELECT * FROM content_pages WHERE slug = $1", [slug]);
}

export async function listContentPages() {
  return query<ContentPage>("SELECT * FROM content_pages ORDER BY title");
}

const pageSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().max(50000),
});

export async function updateContentPage(actor: Actor | null, slug: string, input: z.input<typeof pageSchema>) {
  assertCan(actor, "settings.manage");
  if (!(slug in CONTENT_PAGES)) throw new UserError("Page inconnue.");
  const d = pageSchema.parse(input);
  await tx(async (db) => {
    const before = await queryOne("SELECT * FROM content_pages WHERE slug = $1 FOR UPDATE", [slug], db);
    await db.query(
      `INSERT INTO content_pages (slug, title, body, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_by = EXCLUDED.updated_by`,
      [slug, d.title, d.body, actor.id],
    );
    await audit(actor, "content_page.update", "content_page", slug, { before, after: d }, db);
  });
}
