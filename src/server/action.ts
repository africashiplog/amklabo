import "server-only";
import { ZodError } from "zod";
import { ForbiddenError, UnauthenticatedError, UserError } from "./errors";

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const initialState: ActionState = {};

/**
 * Exécute une action serveur et convertit les erreurs en un état affichable.
 * Les erreurs inattendues sont journalisées sans être exposées à l'utilisateur.
 */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? "Enregistré." };
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, message: "Veuillez corriger les champs indiqués.", fieldErrors };
    }
    if (err instanceof UserError) return { ok: false, message: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof ForbiddenError || err instanceof UnauthenticatedError) return { ok: false, message: err.message };
    // Les redirections Next.js doivent être relancées.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw err;
    }
    console.error("[action] erreur inattendue:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Une erreur inattendue est survenue. Veuillez réessayer." };
  }
}

export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function formOptional(fd: FormData, key: string): string | null {
  const v = formString(fd, key).trim();
  return v === "" ? null : v;
}
