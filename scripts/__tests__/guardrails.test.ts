/**
 * Proves every CI guardrail actually rejects a known-bad fixture.
 * If one of these starts passing the bad fixture, the guardrail is broken.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { checkActionSource, checkRouteSource, checkRepo } from "../check-actions";
import { checkSchema } from "../check-schema";
import { evaluateAudit } from "../check-npm-audit";
// @ts-expect-error - plain .mjs script without types
import { assessRisk } from "../risk-assess.mjs";

const ROOT = path.resolve(__dirname, "../..");
const fixture = (p: string) => fs.readFileSync(path.join(ROOT, "test/fixtures", p), "utf8");

describe("ESLint: apps may not import @prisma/client or platform/db", () => {
  it("rejects the raw-prisma-import fixture when it lives under src/apps", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(fixture("eslint/raw-prisma-import.ts"), { filePath: path.join(ROOT, "src/apps/demo/actions.ts") });
    const messages = result!.messages.map((m) => `${m.ruleId}: ${m.message}`);
    expect(messages.some((m) => m.startsWith("no-restricted-imports") && m.includes("@prisma/client"))).toBe(true);
    expect(messages.some((m) => m.startsWith("no-restricted-imports") && m.includes("platform DB client"))).toBe(true);
    expect(messages.some((m) => m.startsWith("no-restricted-syntax") && m.includes("Raw SQL"))).toBe(true);
  }, 60_000);
});

describe("check-actions", () => {
  it("rejects exports not created by defineAction (fixture)", () => {
    const v = checkActionSource("src/apps/demo/actions.ts", fixture("check-actions/bad-actions.ts"));
    const msgs = v.map((x) => x.message).join("\n");
    expect(msgs).toContain('Exported function "deleteCase" is not created by defineAction()');
    expect(msgs).toContain('Export "sneaky" is not created by defineAction()');
    expect(msgs).toContain('Export "missingAudit": defineAction() is missing "audit"');
    expect(msgs).not.toContain('"fine"');
  });

  it("accepts a correct actions file", () => {
    expect(checkActionSource("src/apps/demo/actions.ts", fixture("check-actions/good-actions.ts"))).toEqual([]);
  });

  it("rejects inline 'use server' functions", () => {
    const src = `export function Page() { async function act() { "use server"; } return null; }`;
    expect(checkActionSource("src/apps/demo/pages/X.tsx", src)).toHaveLength(1);
  });

  it("rejects an unguarded route handler (fixture)", () => {
    const v = checkRouteSource("src/app/api/x/route.ts", fixture("check-actions/unguarded-route.ts"));
    expect(v.map((x) => x.message)).toEqual(["Route handler GET does not call requirePermission()."]);
  });

  it("the real repo is clean", () => {
    expect(checkRepo()).toEqual([]);
  });
});

describe("check-schema: @pii / @money annotations", () => {
  it("rejects the bad.prisma fixture", () => {
    const msgs = checkSchema(fixture("schema/bad.prisma")).map((v) => v.message);
    expect(msgs).toContain('Payout.customerName looks like personal data but has no "/// @pii" comment.');
    expect(msgs).toContain('Payout.ssn looks like personal data but has no "/// @pii" comment.');
    expect(msgs).toContain("Payout.amount is @money but has type Float; use Int/BigInt minor units or Decimal.");
    expect(msgs).toContain('Payout.feeCents looks like money but has no "/// @money" comment.');
  });

  it("the real schema is clean", () => {
    expect(checkSchema(fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8"))).toEqual([]);
  });
});

describe("risk-assess (needs-security-review label)", () => {
  it("flags a diff touching a @pii field", () => {
    expect(assessRisk(fixture("risk/pii-field.diff"))).toEqual(["prisma/schema.prisma: touches a field annotated @pii/@money"]);
  });
  it("flags a diff granting a refund permission", () => {
    const reasons: string[] = assessRisk(fixture("risk/permission.diff"));
    expect(reasons.some((r) => r.includes("sensitive permission"))).toBe(true);
  });
  it("does not flag a cosmetic diff", () => {
    expect(assessRisk(fixture("risk/benign.diff"))).toEqual([]);
  });
});

describe("npm audit gate", () => {
  const report = JSON.parse(fixture("npm-audit/report.json"));
  const allowlist = [{ id: "GHSA-allowed-0001", package: "next", reason: "test", expires: "2999-01-01" }];

  it("fails on a high advisory that is not allowlisted (fixture)", () => {
    const r = evaluateAudit(report, allowlist);
    expect(r.failures).toEqual(["left-pad-evil GHSA-evil-9999 (high) Prototype pollution"]);
    expect(r.allowed).toEqual(["next GHSA-allowed-0001"]);
  });

  it("expired allowlist entries stop counting", () => {
    const r = evaluateAudit(report, [{ ...allowlist[0]!, expires: "2000-01-01" }]);
    expect(r.failures).toHaveLength(2);
  });
});
