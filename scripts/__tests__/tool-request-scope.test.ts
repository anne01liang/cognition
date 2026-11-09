import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkToolRequestScope, DEFAULT_BOT_LOGIN, isCheckedPr, type ChangedFile } from "../check-tool-request-scope";

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
const goodRegistryDiff = [
  "@@ -4,0 +5 @@",
  '+import { deskBookingNotesApp } from "./desk-booking-notes/manifest";',
  "@@ -10 +11 @@",
  "-export const APPS: readonly AppManifest[] = [kycApp, refundsApp];",
  "+export const APPS: readonly AppManifest[] = [kycApp, refundsApp, deskBookingNotesApp];",
].join("\n");
const goodMigration = [
  "-- CreateTable",
  'CREATE TABLE "DeskBookingNote" ("id" TEXT NOT NULL, "createdById" TEXT NOT NULL, CONSTRAINT "DeskBookingNote_pkey" PRIMARY KEY ("id"));',
  'CREATE INDEX "DeskBookingNote_createdById_idx" ON "DeskBookingNote"("createdById");',
  'ALTER TABLE "DeskBookingNote" ADD CONSTRAINT "DeskBookingNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id");',
].join("\n");
const MIG = "prisma/migrations/20261109000000_desk_booking_notes_init/migration.sql";
const check = (over: { files?: ChangedFile[]; rbacDiff?: string; diffs?: Record<string, string>; migration?: string }) =>
  checkToolRequestScope({
    files: over.files ?? appFiles,
    diffs: { "src/platform/rbac.ts": over.rbacDiff ?? goodRbacDiff, "src/apps/registry.ts": goodRegistryDiff, ...over.diffs },
    migrations: { [MIG]: over.migration ?? goodMigration },
    baseRbac,
  });

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
    expect(checkToolRequestScope({ files, diffs: { "src/platform/rbac.ts": rbacDiff }, migrations: {}, baseRbac })[0]).toMatch(/namespace "tools" already exists/);
  });

  it("rejects registry, schema and seed edits that change other apps", () => {
    const dropsRefunds = goodRegistryDiff.replace("[kycApp, refundsApp, deskBookingNotesApp]", "[kycApp, deskBookingNotesApp]");
    expect(check({ diffs: { "src/apps/registry.ts": dropsRefunds } })).toHaveLength(2);
    const schema = '@@ -20 +20 @@\n-  amountCents Int /// @money\n+  amountCents Int';
    expect(check({ diffs: { "prisma/schema.prisma": schema } })[0]).toMatch(/schema\.prisma: may only add lines/);
    expect(check({ diffs: { "prisma/schema.prisma": "@@ -30,0 +31 @@\n+  deskBookingNotes DeskBookingNote[]" } })).toEqual([]);
  });

  it("rejects migrations that touch existing tables or data", () => {
    for (const bad of ['ALTER TABLE "User" ADD COLUMN "x" TEXT;', 'DROP TRIGGER "audit_append_only" ON "AuditEvent";', 'UPDATE "Refund" SET "status" = \'APPROVED\';', 'CREATE INDEX "i" ON "User"("email");']) {
      expect(check({ migration: `${goodMigration}\n${bad}` })).toHaveLength(1);
    }
  });
});

describe("which PRs are checked", () => {
  it("checks every PR by the Devin bot, whatever its title, and no others", () => {
    expect(isCheckedPr({ author: DEFAULT_BOT_LOGIN, title: "tool-request/abc: Visitor log" })).toBe(true);
    expect(isCheckedPr({ author: DEFAULT_BOT_LOGIN, title: "docs: tidy up" })).toBe(true);
    expect(isCheckedPr({ author: "anne01liang", title: "tool-request/abc: Visitor log" })).toBe(false);
    expect(isCheckedPr({ author: DEFAULT_BOT_LOGIN, title: "x" }, "other-bot[bot]")).toBe(false);
  });

  // Fixture: a throwaway git repo where a bot PR renamed away from "tool-request/" also edits a platform file.
  it("CLI: a renamed bot PR is still checked and fails; a human PR is skipped", () => {
    const repo = mkdtempSync(join(tmpdir(), "scope-fixture-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", ...args], { cwd: repo });
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    try {
      git("init", "-q", "-b", "main");
      write("src/platform/rbac.ts", baseRbac);
      write("src/platform/action.ts", "export const x = 1;\n");
      git("add", ".");
      git("commit", "-qm", "base");
      git("checkout", "-qb", "devin/renamed");
      write("src/apps/visitor-log/manifest.ts", "export {};\n");
      write("src/platform/action.ts", "export const x = 2;\n");
      git("add", ".");
      git("commit", "-qm", "app + platform edit");

      const run = (author: string) =>
        spawnSync(resolve("node_modules/.bin/tsx"), [resolve("scripts/check-tool-request-scope.ts")], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, PR_AUTHOR: author, PR_TITLE: "docs: tidy up", BASE_REF: "main", TOOL_REQUEST_BOT_LOGIN: "" },
        });
      const bot = run(DEFAULT_BOT_LOGIN);
      expect(bot.status).toBe(1);
      expect(bot.stderr).toContain("src/platform/action.ts: outside the files a tool-request app may change");
      const human = run("anne01liang");
      expect(human.status).toBe(0);
      expect(human.stdout).toContain("skipped");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});
