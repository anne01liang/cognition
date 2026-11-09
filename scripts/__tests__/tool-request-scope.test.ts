import { describe, expect, it } from "vitest";
import { checkToolRequestScope, type ChangedFile } from "../check-tool-request-scope";

const baseRbac = `export const PERMISSIONS = [\n  "tools:request",\n  "tools:approve",\n  "kyc:read",\n];`;
const appFiles: ChangedFile[] = [
  { status: "A", path: "src/apps/desk-booking-notes/manifest.ts" },
  { status: "A", path: "src/apps/desk-booking-notes/actions.ts" },
  { status: "A", path: "src/app/(platform)/apps/desk-booking-notes/page.tsx" },
  { status: "A", path: "prisma/migrations/20261109000000_desk_booking_notes_init/migration.sql" },
  { status: "M", path: "prisma/schema.prisma" },
  { status: "M", path: "src/apps/registry.ts" },
  { status: "M", path: "src/platform/rbac.ts" },
];
const goodRbacDiff = [
  "--- a/src/platform/rbac.ts",
  "+++ b/src/platform/rbac.ts",
  "@@ -19,0 +20,3 @@",
  "+  // ---- app: desk-booking-notes ----",
  '+  "desk_booking_notes:read",',
  '+  "desk_booking_notes:write",',
  "@@ -40 +43 @@",
  '-  ops_lead: ["kyc:read", "tools:request"],',
  '+  ops_lead: ["kyc:read", "tools:request", "desk_booking_notes:read", "desk_booking_notes:write"],',
].join("\n");
const check = (over: { files?: ChangedFile[]; rbacDiff?: string }) =>
  checkToolRequestScope({ files: over.files ?? appFiles, rbacDiff: over.rbacDiff ?? goodRbacDiff, baseRbac });

describe("check-tool-request-scope", () => {
  it("accepts a new app with its own permissions and role grants", () => {
    expect(check({})).toEqual([]);
  });

  it("accepts a new role that holds only the app's permissions", () => {
    expect(check({ rbacDiff: `${goodRbacDiff}\n@@ -44,0 +48 @@\n+  desk_user: ["desk_booking_notes:read"],` })).toEqual([]);
  });

  it("rejects changes to other platform files, dependencies and existing apps", () => {
    const v = check({
      files: [...appFiles, { status: "M", path: "src/platform/action.ts" }, { status: "M", path: "package.json" }, { status: "M", path: "src/apps/refunds/actions.ts" }],
    });
    expect(v.join("\n")).toMatch(/exactly one src\/apps/);
    const one = check({ files: [...appFiles, { status: "M", path: "src/platform/action.ts" }, { status: "M", path: "package.json" }] });
    expect(one).toEqual(["src/platform/action.ts: outside the files a tool-request app may change", "package.json: outside the files a tool-request app may change"]);
  });

  it("rejects overwriting an existing file of the app or an existing migration", () => {
    const files = appFiles.map((f) => (f.path.endsWith("actions.ts") || f.path.includes("migrations") ? { ...f, status: "M" } : f));
    expect(check({ files })).toHaveLength(2);
  });

  it("rejects rbac.ts edits beyond the app's namespace", () => {
    const grantsPlatform = goodRbacDiff.replace('"tools:request", "desk_booking_notes:read"', '"tools:request", "tools:approve", "desk_booking_notes:read"');
    expect(check({ rbacDiff: grantsPlatform })).toHaveLength(2);
    const removesPermission = `${goodRbacDiff}\n@@ -18 +17,0 @@\n-  "tools:approve",`;
    expect(check({ rbacDiff: removesPermission })[0]).toMatch(/removed or changed line/);
  });

  it("rejects granting the app's permissions to admin", () => {
    const admin = `${goodRbacDiff}\n@@ -41 +45 @@\n-  admin: ["audit:read"],\n+  admin: ["audit:read", "desk_booking_notes:read"],`;
    expect(check({ rbacDiff: admin })).toEqual(["src/platform/rbac.ts: desk_booking_notes:* may not be granted to admin"]);
  });

  it("rejects an app whose namespace already exists (e.g. an app called 'tools')", () => {
    const files: ChangedFile[] = [{ status: "A", path: "src/apps/tools/actions.ts" }, { status: "M", path: "src/platform/rbac.ts" }];
    const rbacDiff = '@@ -40 +40 @@\n-  ops_lead: ["kyc:read"],\n+  ops_lead: ["kyc:read", "tools:approve"],';
    expect(checkToolRequestScope({ files, rbacDiff, baseRbac })[0]).toMatch(/namespace "tools" already exists/);
  });
});
