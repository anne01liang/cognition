import type { Permission } from "@/platform/rbac";

/** Typed references to permissions declared in src/platform/rbac.ts. Never invent strings here. */
export const REFUND = {
  read: "refund:read",
  request: "refund:request",
  approve: "refund:approve",
  escalation: "refund:escalation",
} as const satisfies Record<string, Permission>;
