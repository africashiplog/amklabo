import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors";

/**
 * Stockage local des fichiers (disque du serveur). Pour un hébergement
 * multi-instances, remplacer ces fonctions par un stockage objet
 * (Supabase Storage, S3…) en conservant la même interface.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");

export function detectImageType(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export function isPdf(buf: Buffer) {
  return buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-";
}

/** Enregistre un document PDF public (pages juridiques) validé par sa signature ; retourne son chemin relatif. */
export async function savePdf(file: File): Promise<string> {
  if (file.size === 0) throw new UserError("Le fichier est vide.");
  if (file.size > MAX_PDF_BYTES) throw new UserError("Le PDF dépasse la taille maximale de 5 Mo.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isPdf(buf)) throw new UserError("Format non pris en charge : seul un fichier PDF est accepté.");
  const rel = `documents/${randomUUID()}.pdf`;
  const abs = path.join(uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf, { flag: "wx" });
  return rel;
}

/** Enregistre une image validée par sa signature binaire ; retourne son chemin relatif. */
export async function saveImage(
  file: File, folder: "products" | "brand" | "payments", allowed: ("png" | "jpg" | "webp")[] = ["png", "jpg", "webp"],
): Promise<string> {
  if (file.size === 0) throw new UserError("Le fichier est vide.");
  if (file.size > MAX_IMAGE_BYTES) throw new UserError("L'image dépasse la taille maximale de 5 Mo.");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buf);
  if (!type || !allowed.includes(type)) {
    throw new UserError(`Format non pris en charge. Utilisez ${allowed.map((a) => (a === "jpg" ? "JPEG" : a.toUpperCase())).join(", ")}.`);
  }
  const rel = `${folder}/${randomUUID()}.${type}`;
  const abs = path.join(uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf, { flag: "wx" });
  return rel;
}

/**
 * Résout un chemin relatif en empêchant toute sortie du répertoire de stockage.
 * Les justificatifs de paiement (dossier « payments ») ne sont jamais servis
 * publiquement : ils ne sont résolus qu'avec privateFiles = true, après contrôle des droits.
 */
export function resolveStoragePath(rel: string, privateFiles = false): string | null {
  const ok = privateFiles
    ? /^payments\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(rel)
    : /^(products|brand)\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(rel) || /^documents\/[0-9a-f-]{36}\.pdf$/.test(rel);
  if (!ok) return null;
  const root = uploadRoot();
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export async function deleteStoredFile(rel: string) {
  const abs = resolveStoragePath(rel) ?? resolveStoragePath(rel, true);
  if (abs) await fs.rm(abs, { force: true });
}

/** URL publique d'un fichier stocké. */
export const mediaUrl = (rel: string) => `/media/${rel}`;
