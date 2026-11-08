export type ActionErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";

/** Errors that are safe to show to the user. Anything else becomes INTERNAL. */
export class ActionError extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export class UnauthenticatedError extends ActionError {
  constructor() {
    super("UNAUTHENTICATED", "You must be signed in.");
  }
}

export class ForbiddenError extends ActionError {
  constructor(permission: string) {
    super("FORBIDDEN", `Missing permission: ${permission}`);
  }
}

export class NotFoundError extends ActionError {
  constructor(what = "Record") {
    super("NOT_FOUND", `${what} not found.`);
  }
}

export class ConflictError extends ActionError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}
