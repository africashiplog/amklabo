import { can, type Permission, type Role } from "./permissions";
import { ForbiddenError, UnauthenticatedError } from "./errors";

/** Utilisateur authentifié à l'origine d'une opération. */
export type Actor = {
  id: string;
  email: string;
  fullName: string;
  roles: Role[];
  ip?: string | null;
};

export function assertCan(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (!can(actor.roles, permission)) throw new ForbiddenError();
}
