import { z } from "zod";

/** Messages de validation par défaut en français. */
const frErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" || issue.received === "null" ? "Champ requis" : "Valeur invalide" };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? `Au moins ${issue.minimum} caractère(s)` : `Valeur minimale : ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `Au plus ${issue.maximum} caractères` : `Valeur maximale : ${issue.maximum}` };
    case z.ZodIssueCode.invalid_string:
      return { message: "Format invalide" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Choix invalide" };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(frErrorMap);

/** Entier saisi dans un formulaire (chaîne) ou fourni directement. */
export const intField = (min: number, max: number) =>
  z
    .union([z.number(), z.string().trim()])
    .pipe(z.coerce.number().int("Nombre entier attendu").min(min, `Valeur minimale : ${min}`).max(max, `Valeur maximale : ${max}`));

export { z };
