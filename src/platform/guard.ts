import { ForbiddenError, UnauthenticatedError } from "./errors";
import type { Permission } from "./rbac";

export interface SessionLike {
  userId: string;
  permissions: ReadonlySet<Permission>;
}

/** The one server-side authorization check. Throws on failure. */
export function requirePermission<S extends SessionLike>(session: S | null | undefined, permission: Permission): S {
  if (!session) throw new UnauthenticatedError();
  if (!session.permissions.has(permission)) throw new ForbiddenError(permission);
  return session;
}

/** UI-only convenience for hiding controls. Never use as the authorization check. */
export function hasPermission(session: SessionLike | null | undefined, permission: Permission): boolean {
  return !!session && session.permissions.has(permission);
}
