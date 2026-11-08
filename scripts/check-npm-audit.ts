/**
 * `npm audit --audit-level=high` with an explicit, expiring allowlist.
 *
 * Fails on any high/critical advisory unless its GHSA id is listed in
 * security/npm-audit-allowlist.json with a reason and a non-expired date.
 * The allowlist exists ONLY because the mandated stack pins Next.js 14,
 * whose remaining advisories are fixed only in Next >= 15.
 *
 * Usage: tsx scripts/check-npm-audit.ts [--report audit.json]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface AuditVia {
  url?: string;
  title?: string;
  severity?: string;
  name?: string;
}
interface AuditReport {
  vulnerabilities: Record<string, { severity: string; via: (string | AuditVia)[] }>;
}
export interface AllowlistEntry {
  id: string;
  package: string;
  reason: string;
  expires: string;
}

export function evaluateAudit(report: AuditReport, allowlist: AllowlistEntry[], today = new Date()) {
  const failures: string[] = [];
  const allowed: string[] = [];
  const active = new Map(allowlist.filter((a) => new Date(a.expires) >= today).map((a) => [a.id, a]));
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via === "string") continue;
      if (!["high", "critical"].includes(via.severity ?? "")) continue;
      const id = via.url?.split("/").pop() ?? "unknown";
      const entry = active.get(id);
      if (entry && entry.package === pkg) allowed.push(`${pkg} ${id}`);
      else failures.push(`${pkg} ${id} (${via.severity}) ${via.title ?? ""}`.trim());
    }
  }
  return { failures: [...new Set(failures)], allowed: [...new Set(allowed)] };
}

function main() {
  const idx = process.argv.indexOf("--report");
  const raw =
    idx > -1
      ? fs.readFileSync(process.argv[idx + 1]!, "utf8")
      : (() => {
          try {
            return execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          } catch (e) {
            return (e as { stdout: string }).stdout; // npm audit exits non-zero when it finds anything
          }
        })();
  const allowlist: AllowlistEntry[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../security/npm-audit-allowlist.json"), "utf8")).advisories;
  const { failures, allowed } = evaluateAudit(JSON.parse(raw), allowlist);
  if (allowed.length) console.log(`npm-audit: ${allowed.length} high/critical advisories allowlisted (see security/npm-audit-allowlist.json)`);
  if (failures.length) {
    console.error(`npm-audit: ${failures.length} high/critical advisories NOT allowlisted:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("npm-audit: OK (no un-allowlisted high/critical advisories)");
}

if (require.main === module) main();
