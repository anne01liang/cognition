import type { Permission } from "@/platform/rbac";

/** Typed references to permissions declared in src/platform/rbac.ts. Never invent strings here. */
export const VISITOR_LOG = {
  read: "visitor_log:read",
  write: "visitor_log:write",
} as const satisfies Record<string, Permission>;
