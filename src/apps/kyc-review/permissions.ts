import type { Permission } from "@/platform/rbac";

/** Typed references to permissions declared in src/platform/rbac.ts. Never invent strings here. */
export const KYC_REVIEW = {
  /** See the queue and case files (analysts + approvers). */
  queue: "kyc:queue",
  /** Claim cases and recommend APPROVE / REJECT / ESCALATE (maker). */
  review: "kyc:review",
  /** Finalize cases that need a second person (checker). */
  approve: "kyc:approve",
} as const satisfies Record<string, Permission>;
