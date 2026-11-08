import "server-only";
import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";
import { permissionsForRoles, type Permission } from "./rbac";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { redirect } from "next/navigation";

export interface AppSession {
  userId: string;
  username: string;
  name: string;
  roles: string[];
  permissions: ReadonlySet<Permission>;
}

/**
 * Resolves the signed-in user. Roles are re-read from the database on every
 * request, so revoking a role takes effect immediately (the JWT only carries
 * the user id).
 */
export const getAppSession = cache(async (): Promise<AppSession | null> => {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    roles: user.roles,
    permissions: permissionsForRoles(user.roles),
  };
});

export { requirePermission, hasPermission } from "./guard";

/** For server components (pages). Redirects instead of throwing. */
export async function requirePagePermission(permission: Permission): Promise<AppSession> {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!session.permissions.has(permission)) redirect(`/forbidden?permission=${encodeURIComponent(permission)}`);
  return session;
}

export { ForbiddenError, UnauthenticatedError };
