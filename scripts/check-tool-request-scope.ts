/**
 * Every PR opened by the Devin bot account (TOOL_REQUEST_BOT_LOGIN, default devin-ai-integration[bot]) is checked,
 * whatever its title or labels say, since both are editable. Such a PR may only add one new app: its folder, route
 * shims, registry entry, schema/migration/seed additions, and in src/platform/rbac.ts only that app's own permission
 * strings and role grants. Anything else needs a PR from a human account.
 * This only protects main if the `scope` job is a required status check (see GITHUB_SETUP.md "Branch protection").
 */
import { execFileSync } from "node:child_process";

export interface ChangedFile {
  status: string; // git --name-status letter: A, M, D, ...
  path: string;
}

export interface ScopeInput {
  files: ChangedFile[];
  /** `git diff -U0` per modified shared file (registry.ts, schema.prisma, seed.ts, rbac.ts). */
  diffs: Record<string, string>;
  /** Contents of added migration.sql files. */
  migrations: Record<string, string>;
  baseRbac: string;
}

export const DEFAULT_BOT_LOGIN = "devin-ai-integration[bot]";

/** The title is deliberately ignored: renaming a bot PR must not skip the check. */
export function isCheckedPr(pr: { author: string; title: string }, botLogin = DEFAULT_BOT_LOGIN): boolean {
  // GitHub logins are case-insensitive.
  return pr.author.toLowerCase() === botLogin.toLowerCase();
}

const APP_FILE = /^src\/apps\/([a-z][a-z-]*)\//;
const MIGRATION = /^prisma\/migrations\/[^/]+\/migration\.sql$/;
const RBAC = "src/platform/rbac.ts";
const REGISTRY = "src/apps/registry.ts";
const ADD_ONLY = ["prisma/schema.prisma", "prisma/seed.ts"];
const SHARED_FILES = [RBAC, REGISTRY, "src/apps/registry.test.ts", ...ADD_ONLY];

export function checkToolRequestScope(input: ScopeInput): string[] {
  const appIds = [...new Set(input.files.map((f) => APP_FILE.exec(f.path)?.[1]).filter((x): x is string => !!x))];
  if (appIds.length !== 1) {
    return [`expected changes under exactly one src/apps/<id>/ folder, found ${appIds.length ? appIds.join(", ") : "none"}`];
  }
  const id = appIds[0]!;
  const ns = id.replace(/-/g, "_");
  const out: string[] = [];
  if (input.baseRbac.includes(`"${ns}:`)) out.push(`namespace "${ns}" already exists in ${RBAC}; a tool request must add a new app`);

  for (const f of input.files) {
    const ownNew = f.path.startsWith(`src/apps/${id}/`) || f.path.startsWith(`src/app/(platform)/apps/${id}/`) || MIGRATION.test(f.path);
    if (ownNew) {
      if (f.status !== "A") out.push(`${f.path}: must be a new file (status ${f.status}); tool requests may not change existing apps or migrations`);
    } else if (!SHARED_FILES.includes(f.path)) {
      out.push(`${f.path}: outside the files a tool-request app may change`);
    } else if (f.status !== "M") {
      out.push(`${f.path}: may only be modified (status ${f.status})`);
    }
  }
  for (const file of ADD_ONLY) {
    const removed = diffLines(input.diffs[file] ?? "").removed.filter((l) => l.trim());
    if (removed.length) out.push(`${file}: may only add lines (removes or changes: ${removed[0]!.trim()})`);
  }
  for (const [file, sql] of Object.entries(input.migrations)) out.push(...checkMigration(file, sql));
  out.push(...checkRegistryDiff(input.diffs[REGISTRY] ?? "", id));
  out.push(...checkRbacDiff(input.diffs[RBAC] ?? "", ns));
  return out;
}

function diffLines(diff: string) {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
  }
  return { removed, added };
}

/** Changed lines must be identical once `norm` strips what the app may add; `extraOk` allows wholly new lines. */
function compareChanged(file: string, diff: string, norm: (l: string) => string, extraOk: (normalized: string) => boolean): string[] {
  const { removed, added } = diffLines(diff);
  const out: string[] = [];
  const unmatched = new Map<string, number>();
  for (const l of removed.map(norm).filter(Boolean)) unmatched.set(l, (unmatched.get(l) ?? 0) + 1);
  for (const l of added.map(norm).filter(Boolean)) {
    const n = unmatched.get(l) ?? 0;
    if (n > 0) unmatched.set(l, n - 1);
    else if (!extraOk(l)) out.push(`${file}: added line changes more than this app's entries: ${l}`);
  }
  for (const [l, n] of unmatched) if (n > 0) out.push(`${file}: removed or changed line: ${l}`);
  return out;
}

const squash = (l: string) => l.replace(/\s+/g, "").replace(/,(?=[\])}])/g, "").replace(/,$/, "");

/** Every changed line in rbac.ts must differ only by `"<ns>:<verb>"` strings, the app's section comment, or a new role holding only them. */
export function checkRbacDiff(diff: string, ns: string): string[] {
  const own = `"${ns}:[a-z_]+"`;
  const out = diffLines(diff)
    .added.filter((l) => /^\s*admin\s*:/.test(l) && new RegExp(own).test(l))
    .map(() => `${RBAC}: ${ns}:* may not be granted to admin`);
  const norm = (l: string) => squash(l.replace(new RegExp(`${own}\\s*,?`, "g"), "").replace(/^\s*\/\/ ---- app: [a-z_-]+ ----\s*$/, ""));
  return [...out, ...compareChanged(RBAC, diff, norm, (l) => /^[a-z_]+:\[\]$/.test(l) && !l.startsWith("admin:"))];
}

/** registry.ts may only gain imports from `./<id>/` and those identifiers in existing lines. */
export function checkRegistryDiff(diff: string, id: string): string[] {
  const ownImport = new RegExp(`^\\s*import\\s*\\{([^}]*)\\}\\s*from\\s*["']\\./${id}/[^"']+["'];?\\s*$`);
  const names = diffLines(diff).added.flatMap((l) => ownImport.exec(l)?.[1]?.split(",").map((n) => n.trim()).filter(Boolean) ?? []);
  const norm = (l: string) => {
    if (ownImport.test(l)) return "";
    return squash(names.reduce((s, n) => s.replace(new RegExp(`\\b${n}\\b\\s*,?`, "g"), ""), l));
  };
  return compareChanged(REGISTRY, diff, norm, () => false);
}

/** A new app's migration may only create its own types, tables, indexes and constraints. */
export function checkMigration(file: string, sql: string): string[] {
  const statements = sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const created = new Set(statements.map((s) => /^CREATE TABLE "([^"]+)"/i.exec(s)?.[1]).filter(Boolean));
  const out: string[] = [];
  for (const s of statements) {
    if (/^CREATE (TYPE|TABLE) "[^"]+"/i.test(s)) continue;
    const index = /^CREATE (UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/i.exec(s);
    if (index && created.has(index[2])) continue;
    const alter = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" (FOREIGN KEY|PRIMARY KEY|UNIQUE)\b/i.exec(s);
    if (alter && created.has(alter[1])) continue;
    out.push(`${file}: only CREATE TYPE/TABLE and indexes/constraints on this migration's new tables are allowed: ${s.slice(0, 80)}`);
  }
  return out;
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

function main() {
  const author = process.env.PR_AUTHOR;
  if (!author) {
    console.error("check-tool-request-scope: PR_AUTHOR is not set; refusing to skip the check");
    process.exit(1);
  }
  const botLogin = process.env.TOOL_REQUEST_BOT_LOGIN || DEFAULT_BOT_LOGIN;
  if (!isCheckedPr({ author, title: process.env.PR_TITLE ?? "" }, botLogin)) {
    console.log(`check-tool-request-scope: PR by ${author}, not ${botLogin}; skipped`);
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
  const diffs = Object.fromEntries(SHARED_FILES.map((f) => [f, git("diff", "-U0", base, "HEAD", "--", f)]));
  const migrations = Object.fromEntries(files.filter((f) => f.status === "A" && MIGRATION.test(f.path)).map((f) => [f.path, git("show", `HEAD:${f.path}`)]));
  const violations = checkToolRequestScope({ files, diffs, migrations, baseRbac: git("show", `${base}:${RBAC}`) });
  if (violations.length) {
    console.error(`check-tool-request-scope: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log("check-tool-request-scope: OK");
}

if (require.main === module) main();
