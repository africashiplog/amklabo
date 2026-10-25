import { z } from "zod";

/** Messages de validation par défaut en français (zod 4). */
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined || issue.input === null ? "Champ requis" : "Valeur invalide";
      case "too_small":
        return issue.origin === "string" ? `Au moins ${issue.minimum} caractère(s)` : `Valeur minimale : ${issue.minimum}`;
      case "too_big":
        return issue.origin === "string" ? `Au plus ${issue.maximum} caractères` : `Valeur maximale : ${issue.maximum}`;
      case "invalid_format":
        return issue.format === "email" ? "Adresse e-mail invalide" : "Format invalide";
      case "invalid_value":
        return "Choix invalide";
      default:
        return undefined;
    }
  },
});

/** Entier saisi dans un formulaire (chaîne) ou fourni directement. */
export const intField = (min: number, max: number) =>
  z
    .union([z.number(), z.string().trim()])
    .pipe(z.coerce.number<string | number>().int("Nombre entier attendu").min(min, `Valeur minimale : ${min}`).max(max, `Valeur maximale : ${max}`));

export { z };
