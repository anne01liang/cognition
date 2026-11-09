/**
 * SINGLE SOURCE OF TRUTH for roles and permissions.
 *
 * - Permission strings are `<namespace>:<verb>`; the namespace is the app id
 *   (or a platform namespace: audit, pii).
 * - Apps reference permissions via src/apps/<app>/permissions.ts, which must
 *   only re-export strings declared here (enforced by tests).
 * - Changes to this file require security-reviewer review (CODEOWNERS), and
 *   sensitive permission changes trigger the `needs-security-review` label.
 * - Admin is NOT a superuser: it can read/verify audit and request/approve new tools, nothing else.
 */

export const PERMISSIONS = [
  // ---- platform ----
  "audit:read",
  "audit:verify",
  "pii:reveal",
  "tools:request",
  "tools:approve",
  // ---- app: kyc ----
  "kyc:read",
  "kyc:create",
  "kyc:review",
  "kyc:approve",
  "kyc:escalation",
  // ---- app: refunds ----
  "refund:read",
  "refund:request",
  "refund:approve",
  "refund:escalation",
  // ---- app: visitor-log ----
  "visitor_log:read",
  "visitor_log:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = {
  kyc_analyst: ["kyc:read", "kyc:create", "kyc:review", "pii:reveal"],
  kyc_approver: ["kyc:read", "kyc:approve", "pii:reveal"],
  support: ["kyc:read", "refund:read", "refund:request", "visitor_log:read", "visitor_log:write"],
  finance_approver: ["refund:read", "refund:approve", "pii:reveal"],
  ops_lead: ["kyc:read", "refund:read", "kyc:escalation", "refund:escalation", "tools:request"],
  admin: ["audit:read", "audit:verify", "tools:request", "tools:approve"],
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLES;

export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(ROLES, value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    if (!isRole(role)) continue;
    for (const p of ROLES[role]) result.add(p);
  }
  return result;
}
