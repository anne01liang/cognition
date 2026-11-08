#!/usr/bin/env node
/**
 * Decides whether a PR diff needs security review. Dependency-free so the
 * risk-label workflow can run it without `npm ci`.
 *
 * A diff is risky if a hunk that changes at least one line:
 *   - contains a `@pii` or `@money` annotation (changed or as context), or
 *   - changes a permission string matching /refund|payment|payout|pii/
 *     (e.g. "refund:approve") anywhere in the diff.
 *
 * Usage: git diff -U3 base...head | node scripts/risk-assess.mjs
 * Prints reasons; writes `risky=true|false` to $GITHUB_OUTPUT if set.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SENSITIVE_PERMISSION = /["'`][a-z_]*(refund|payment|payout|pii)[a-z_]*:[a-z_:]+["'`]|["'`][a-z_]+:[a-z_:]*(refund|payment|payout|pii)[a-z_:]*["'`]/i;

/** @param {string} diff */
export function assessRisk(diff) {
  const reasons = new Set();
  let file = "";
  /** @type {string[]} */
  let hunk = [];
  const flush = () => {
    const changed = hunk.filter((l) => /^[+-]/.test(l));
    if (changed.length && hunk.some((l) => /@(pii|money)\b/.test(l))) {
      reasons.add(`${file}: touches a field annotated @pii/@money`);
    }
    for (const l of changed) {
      if (SENSITIVE_PERMISSION.test(l)) reasons.add(`${file}: changes sensitive permission ${l.match(SENSITIVE_PERMISSION)[0]}`);
    }
    hunk = [];
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      file = line.split(" b/")[1] ?? line;
    } else if (line.startsWith("@@")) {
      flush();
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    } else {
      hunk.push(line);
    }
  }
  flush();
  return [...reasons];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : fs.readFileSync(0, "utf8");
  const reasons = assessRisk(input);
  if (reasons.length) {
    console.log("needs-security-review:");
    for (const r of reasons) console.log(`  - ${r}`);
  } else console.log("risk-assess: no sensitive changes detected");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `risky=${reasons.length > 0}\n`);
  if (process.argv.includes("--fail-if-risky") && reasons.length) process.exit(1);
}
