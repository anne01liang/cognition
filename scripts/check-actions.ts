/**
 * CI guardrail: every server entry point is guarded.
 *
 *  1. Any file under src/apps with a top-level "use server" directive may only
 *     export `const x = defineAction({ permission, input, audit, handler })`,
 *     with defineAction imported from "@/platform/action".
 *  2. Inline "use server" (inside a function) is forbidden under src/apps.
 *  3. Every src/app/** /route.ts handler must call requirePermission(), unless allowlisted.
 *  4. Every src/app/** /page.tsx must call requirePagePermission() (directly or via
 *     a `export { default } from "@/apps/..."` shim), unless allowlisted.
 *
 * Usage: tsx scripts/check-actions.ts            (scan the repo)
 *        tsx scripts/check-actions.ts <file...>  (check specific files, used for fixtures)
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface Violation {
  file: string;
  line: number;
  message: string;
}

const ROOT = path.resolve(__dirname, "..");

/** Unauthenticated or session-only entry points. Adding to this list requires security-reviewer (CODEOWNERS) review. */
export const ROUTE_ALLOWLIST = ["src/app/api/auth/[...nextauth]/route.ts"];
export const PAGE_ALLOWLIST = ["src/app/login/page.tsx", "src/app/forbidden/page.tsx", "src/app/(platform)/page.tsx"];

function hasUseServerDirective(statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[]): boolean {
  for (const s of statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) {
      if (s.expression.text === "use server") return true;
      continue;
    }
    break;
  }
  return false;
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Rules 1 + 2 for one source file under src/apps. */
export function checkActionSource(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const v: Violation[] = [];
  const add = (node: ts.Node, message: string) => v.push({ file, line: lineOf(sf, node), message });

  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)) {
      if (hasUseServerDirective(node.body.statements)) add(node, 'Inline "use server" is forbidden in apps. Put actions in actions.ts using defineAction().');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!hasUseServerDirective(sf.statements)) return v;

  const importsDefineAction = sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "@/platform/action" &&
      !!s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === "defineAction" && !e.propertyName),
  );

  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.isTypeOnly) add(s, "Re-exports are not allowed in a \"use server\" file. Export `const x = defineAction({...})` only.");
      continue;
    }
    if (ts.isExportAssignment(s)) {
      add(s, "Default exports are not allowed in a \"use server\" file.");
      continue;
    }
    if (!isExported(s)) continue;
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;
    if (ts.isFunctionDeclaration(s)) {
      add(s, `Exported function "${s.name?.text ?? "default"}" is not created by defineAction().`);
      continue;
    }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const name = d.name.getText(sf);
        const init = d.initializer;
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "defineAction") {
          add(d, `Export "${name}" is not created by defineAction().`);
          continue;
        }
        if (!importsDefineAction) add(d, `Export "${name}": defineAction must be imported from "@/platform/action".`);
        const arg = init.arguments[0];
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          add(d, `Export "${name}": defineAction() must be called with an object literal.`);
          continue;
        }
        const keys = new Set(arg.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : "")));
        for (const required of ["permission", "input", "audit", "handler"]) {
          if (!keys.has(required)) add(d, `Export "${name}": defineAction() is missing "${required}".`);
        }
      }
      continue;
    }
    add(s, "Unsupported export in a \"use server\" file.");
  }
  return v;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Rule 3 for one route.ts. */
export function checkRouteSource(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const v: Violation[] = [];
  const callsGuard = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requirePermission") found = true;
      if (!found) ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && isExported(s) && s.name && HTTP_METHODS.has(s.name.text)) {
      if (!callsGuard(s)) v.push({ file, line: lineOf(sf, s), message: `Route handler ${s.name.text} does not call requirePermission().` });
    } else if (ts.isVariableStatement(s) && isExported(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_METHODS.has(d.name.text) && (!d.initializer || !callsGuard(d.initializer))) {
          v.push({ file, line: lineOf(sf, d), message: `Route handler ${d.name.text} does not call requirePermission().` });
        }
      }
    } else if (ts.isExportDeclaration(s)) {
      v.push({ file, line: lineOf(sf, s), message: "Route files must declare handlers inline so the guard check can see them." });
    }
  }
  return v;
}

/** Rule 4 for one page.tsx (follows a single re-export shim). */
export function checkPageSource(file: string, source: string, readFile: (p: string) => string | null): Violation[] {
  if (source.includes("requirePagePermission(")) return [];
  const shim = source.match(/export\s*\{\s*default\s*\}\s*from\s*["']@\/(apps\/[^"']+)["']/);
  if (shim) {
    const target = readFile(`src/${shim[1]}.tsx`) ?? readFile(`src/${shim[1]}.ts`);
    if (target?.includes("requirePagePermission(")) return [];
    return [{ file, line: 1, message: `Page re-exports src/${shim[1]} which does not call requirePagePermission().` }];
  }
  return [{ file, line: 1, message: "Page does not call requirePagePermission()." }];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const readRel = (p: string) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), "utf8") : null);

export function checkFile(relPath: string, source: string): Violation[] {
  const base = path.basename(relPath);
  if (base === "route.ts") return ROUTE_ALLOWLIST.includes(relPath) ? [] : checkRouteSource(relPath, source);
  if (base === "page.tsx" && relPath.startsWith("src/app/")) return PAGE_ALLOWLIST.includes(relPath) ? [] : checkPageSource(relPath, source, readRel);
  return checkActionSource(relPath, source);
}

export function checkRepo(): Violation[] {
  const files = [...walk(path.join(ROOT, "src/apps")), ...walk(path.join(ROOT, "src/app")).filter((f) => /\/(route\.ts|page\.tsx)$/.test(f))];
  return files.flatMap((f) => checkFile(rel(f), fs.readFileSync(f, "utf8")));
}

// Lets CI/devs run the checker on a fixture as if it lived at a real app/route path.
function fixtureTarget(relPath: string): string {
  if (!relPath.startsWith("test/fixtures/check-actions/")) return relPath;
  const name = path.basename(relPath);
  return name.endsWith("route.ts") ? "src/app/api/__fixture__/route.ts" : `src/apps/__fixture__/${name}`;
}

function main() {
  const args = process.argv.slice(2);
  const violations = args.length
    ? args.flatMap((a) => checkFile(fixtureTarget(rel(path.resolve(a))), fs.readFileSync(a, "utf8")))
    : checkRepo();
  if (violations.length) {
    console.error(`check-actions: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.message}`);
    process.exit(1);
  }
  console.log("check-actions: OK");
}

if (require.main === module) main();
