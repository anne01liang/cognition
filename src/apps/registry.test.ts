/** Enforces the app module convention described in ADDING_AN_APP.md. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPS, visibleApps } from "./registry";
import { PERMISSIONS, permissionsForRoles } from "@/platform/rbac";

const APPS_DIR = path.resolve(__dirname);
const appDirs = fs
  .readdirSync(APPS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name);

describe("app registry convention", () => {
  it("every folder in src/apps is registered, and every registered app has a folder", () => {
    expect(APPS.map((a) => a.id).sort()).toEqual([...appDirs].sort());
  });

  describe.each(appDirs)("src/apps/%s", (dir) => {
    const p = (f: string) => path.join(APPS_DIR, dir, f);
    const app = APPS.find((a) => a.id === dir)!;

    it("has the required files", () => {
      for (const f of ["manifest.ts", "permissions.ts", "actions.ts", "schemas.ts", "pages", "__tests__"]) {
        expect(fs.existsSync(p(f)), `${dir}/${f} is missing`).toBe(true);
      }
      expect(fs.readdirSync(p("__tests__")).some((f) => f.endsWith(".test.ts")), `${dir}/__tests__ has no tests`).toBe(true);
    });

    it("actions.ts is a 'use server' file", () => {
      expect(fs.readFileSync(p("actions.ts"), "utf8").trimStart().startsWith('"use server"')).toBe(true);
    });

    it("basePath is /apps/<id> and has a route shim", () => {
      expect(app.basePath).toBe(`/apps/${dir}`);
      expect(fs.existsSync(path.resolve(APPS_DIR, `../app/(platform)/apps/${dir}/page.tsx`))).toBe(true);
    });

    it("permissions.ts only references permissions declared in rbac.ts, under one namespace", async () => {
      const mod = await import(`./${dir}/permissions.ts`);
      const values = Object.values(mod).flatMap((o) => Object.values(o as Record<string, string>));
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(PERMISSIONS).toContain(v);
      expect(new Set(values.map((v) => v.split(":")[0])).size).toBe(1);
      for (const item of [app.permission, ...app.nav.map((n) => n.permission)]) expect(values).toContain(item);
    });
  });

  it("nav is filtered by permission", () => {
    expect(visibleApps(permissionsForRoles(["kyc_analyst"])).map((a) => a.id)).toEqual(["kyc"]);
    expect(visibleApps(permissionsForRoles(["admin"]))).toEqual([]);
    const support = visibleApps(permissionsForRoles(["support"]));
    expect(support.map((a) => a.id)).toEqual(["kyc", "refunds", "visitor-log"]);
    expect(support.find((a) => a.id === "kyc")!.nav.map((n) => n.label)).toEqual(["Cases"]);
  });
});
