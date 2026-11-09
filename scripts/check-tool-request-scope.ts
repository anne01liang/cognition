/**
 * Tool-request PRs (title "tool-request/...") are built by Devin from a requester's manifest. They may only add
 * one new app: its folder, route shims, registry entry, schema/migration/seed, and in src/platform/rbac.ts only
 * that app's own permission strings and role grants. Everything else needs a normal, human-authored PR.
 */
import { execFileSync } from "node:child_process";

export interface ChangedFile {
  status: string; // git --name-status letter: A, M, D, ...
  path: string;
}

const APP_FILE = /^src\/apps\/([a-z][a-z-]*)\//;
const SHARED_FILES = ["src/apps/registry.ts", "src/apps/registry.test.ts", "prisma/schema.prisma", "prisma/seed.ts", "src/platform/rbac.ts"];

export function checkToolRequestScope(input: { files: ChangedFile[]; rbacDiff: string; baseRbac: string }): string[] {
  const appIds = [...new Set(input.files.map((f) => APP_FILE.exec(f.path)?.[1]).filter((x): x is string => !!x))];
  if (appIds.length !== 1) {
    return [`expected changes under exactly one src/apps/<id>/ folder, found ${appIds.length ? appIds.join(", ") : "none"}`];
  }
  const id = appIds[0]!;
  const ns = id.replace(/-/g, "_");
  const out: string[] = [];
  if (input.baseRbac.includes(`"${ns}:`)) out.push(`namespace "${ns}" already exists in src/platform/rbac.ts; a tool request must add a new app`);

  for (const f of input.files) {
    const ownNew = f.path.startsWith(`src/apps/${id}/`) || f.path.startsWith(`src/app/(platform)/apps/${id}/`) || /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(f.path);
    if (ownNew) {
      if (f.status !== "A") out.push(`${f.path}: must be a new file (status ${f.status}); tool requests may not change existing apps or migrations`);
    } else if (!SHARED_FILES.includes(f.path)) {
      out.push(`${f.path}: outside the files a tool-request app may change`);
    } else if (f.status !== "M") {
      out.push(`${f.path}: may only be modified (status ${f.status})`);
    }
  }
  return [...out, ...checkRbacDiff(input.rbacDiff, ns)];
}

/** Every changed line in rbac.ts must differ only by `"<ns>:<verb>"` strings, the app's section comment, or a new role holding only them. */
export function checkRbacDiff(diff: string, ns: string): string[] {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
  }
  const own = `"${ns}:[a-z_]+"`;
  const norm = (l: string) =>
    l
      .replace(new RegExp(`${own}\\s*,?`, "g"), "")
      .replace(/^\s*\/\/ ---- app: [a-z_-]+ ----\s*$/, "")
      .replace(/\s+/g, "")
      .replace(/,(?=\])/g, "")
      .replace(/,$/, "");

  const out: string[] = [];
  for (const l of added) {
    if (/^\s*admin\s*:/.test(l) && new RegExp(own).test(l)) out.push(`src/platform/rbac.ts: ${ns}:* may not be granted to admin`);
  }
  const unmatched = new Map<string, number>();
  for (const l of removed.map(norm).filter(Boolean)) unmatched.set(l, (unmatched.get(l) ?? 0) + 1);
  for (const l of added.map(norm).filter(Boolean)) {
    const n = unmatched.get(l) ?? 0;
    if (n > 0) unmatched.set(l, n - 1);
    else if (/^[a-z_]+:\[\]$/.test(l) && !l.startsWith("admin:")) continue;
    else out.push(`src/platform/rbac.ts: added line changes more than ${ns}:* permissions: ${l}`);
  }
  for (const [l, n] of unmatched) if (n > 0) out.push(`src/platform/rbac.ts: removed or changed line outside ${ns}:*: ${l}`);
  return out;
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

function main() {
  const title = process.env.PR_TITLE ?? "";
  if (!title.startsWith("tool-request/")) {
    console.log("check-tool-request-scope: not a tool-request PR, skipped");
    return;
  }
  const base = git("merge-base", process.env.BASE_REF ?? "origin/main", "HEAD").trim();
  const files = git("diff", "--name-status", "--no-renames", base, "HEAD")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status = "", path = ""] = l.split("\t");
      return { status, path };
    });
  const violations = checkToolRequestScope({
    files,
    rbacDiff: git("diff", "-U0", base, "HEAD", "--", "src/platform/rbac.ts"),
    baseRbac: git("show", `${base}:src/platform/rbac.ts`),
  });
  if (violations.length) {
    console.error(`check-tool-request-scope: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log("check-tool-request-scope: OK");
}

if (require.main === module) main();
