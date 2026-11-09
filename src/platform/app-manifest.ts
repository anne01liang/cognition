import type { AppTx } from "./types";
import type { Permission } from "./rbac";
import type { SessionLike } from "./guard";

export interface NavItem {
  label: string;
  href: string;
  permission: Permission;
}

/** Loads the raw value of one @pii field for platform revealPii(). */
export interface PiiFieldResolver {
  /** Extra permission needed besides pii:reveal (normally the app's read permission). */
  readPermission: Permission;
  /** `viewer` lets apps with row-level scoping return null (404) for rows the user may not read. */
  load: (tx: AppTx, entityId: string, viewer: SessionLike) => Promise<string | null>;
}

export interface AppManifest {
  /** Folder name under src/apps and permission namespace. */
  id: string;
  name: string;
  description: string;
  /** Must be `/apps/<id>`. */
  basePath: string;
  /** Permission required to see the app in the nav at all. */
  permission: Permission;
  nav: NavItem[];
  /** entityType (Prisma model) -> field -> resolver. Every `/// @pii` field the UI reveals must be listed. */
  pii?: Record<string, Record<string, PiiFieldResolver>>;
}

export function defineApp(manifest: AppManifest): AppManifest {
  return manifest;
}
