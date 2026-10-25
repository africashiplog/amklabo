/** Erreur dont le message peut être affiché tel quel à l'utilisateur. */
export class UserError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "UserError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Vous n'avez pas l'autorisation d'effectuer cette action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Veuillez vous connecter.");
    this.name = "UnauthenticatedError";
  }
}
