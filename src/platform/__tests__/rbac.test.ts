import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, permissionsForRoles } from "../rbac";
import { requirePermission, hasPermission } from "../guard";
import { ForbiddenError, UnauthenticatedError } from "../errors";

describe("rbac", () => {
  it("every permission is granted to at least one role", () => {
    const granted = new Set(Object.values(ROLES).flat());
    expect(PERMISSIONS.filter((p) => !granted.has(p))).toEqual([]);
  });

  it("permissions are namespace:verb", () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it("admin is not a superuser", () => {
    expect(ROLES.admin).toEqual(["audit:read", "audit:verify", "tools:request", "tools:approve"]);
  });

  it("tool requests: ops_lead and admin can request, only admin can approve", () => {
    const holders = (p: string) => Object.entries(ROLES).filter(([, ps]) => (ps as readonly string[]).includes(p)).map(([r]) => r).sort();
    expect(holders("tools:request")).toEqual(["admin", "ops_lead"]);
    expect(holders("tools:approve")).toEqual(["admin"]);
  });

  it("unknown roles grant nothing", () => {
    expect([...permissionsForRoles(["root", "kyc_analyst"])]).toEqual([...ROLES.kyc_analyst]);
  });
});

describe("requirePermission", () => {
  const session = { userId: "u1", permissions: permissionsForRoles(["kyc_analyst"]) };
  it("throws when unauthenticated", () => {
    expect(() => requirePermission(null, "kyc:read")).toThrow(UnauthenticatedError);
  });
  it("throws when the permission is missing", () => {
    expect(() => requirePermission(session, "kyc:approve")).toThrow(ForbiddenError);
  });
  it("returns the session when allowed", () => {
    expect(requirePermission(session, "kyc:read")).toBe(session);
    expect(hasPermission(session, "kyc:approve")).toBe(false);
  });
});
