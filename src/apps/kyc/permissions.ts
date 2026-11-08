import type { Permission } from "@/platform/rbac";

/** Typed references to permissions declared in src/platform/rbac.ts. Never invent strings here. */
export const KYC = {
  read: "kyc:read",
  create: "kyc:create",
  review: "kyc:review",
  approve: "kyc:approve",
  escalation: "kyc:escalation",
} as const satisfies Record<string, Permission>;
