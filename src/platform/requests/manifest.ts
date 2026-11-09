/**
 * Tool Requests: deterministic form -> manifest conversion and validation.
 * Pure and client-safe (used for live validation in the browser and re-checked on the server). No LLM involved.
 */
import yaml from "js-yaml";
import { z } from "zod";
import { ROLES, type Role } from "../rbac";

export const ROLE_NAMES = Object.keys(ROLES) as [Role, ...Role[]];
export const FIELD_TYPES = ["string", "text", "int", "decimal", "boolean", "date", "datetime"] as const;
const NUMERIC_TYPES = new Set<string>(["int", "decimal"]);

const role = z.enum(ROLE_NAMES);
const entityName = z.string().regex(/^[A-Z][A-Za-z0-9]{1,39}$/, "Entity names are PascalCase, e.g. Refund");
const fieldName = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/, "Field names are camelCase, e.g. customerEmail");
const stateName = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, "States are UPPER_SNAKE, e.g. IN_REVIEW");

const fieldSchema = z.object({
  name: fieldName,
  type: z.enum(FIELD_TYPES),
  pii: z.boolean().default(false),
  money: z.boolean().default(false),
});

const entitySchema = z.object({
  name: entityName,
  fields: z.array(fieldSchema).min(1, "Each entity needs at least one field").max(40),
});

const approvalRuleSchema = z.object({
  entity: entityName,
  field: fieldName,
  threshold: z.number().nonnegative(),
  approverRole: role,
});

function checkConsistency(
  m: { entities: z.infer<typeof entitySchema>[]; approvalRule?: z.infer<typeof approvalRuleSchema> | null; primaryUsers: Role[] },
  ctx: z.RefinementCtx,
) {
  const names = new Set<string>();
  m.entities.forEach((e, i) => {
    if (names.has(e.name)) ctx.addIssue({ code: "custom", path: ["entities", i, "name"], message: `Duplicate entity ${e.name}` });
    names.add(e.name);
    const fields = new Set<string>();
    e.fields.forEach((f, j) => {
      if (fields.has(f.name)) ctx.addIssue({ code: "custom", path: ["entities", i, "fields", j, "name"], message: `Duplicate field ${e.name}.${f.name}` });
      fields.add(f.name);
      if (f.money && !NUMERIC_TYPES.has(f.type)) {
        ctx.addIssue({ code: "custom", path: ["entities", i, "fields", j, "type"], message: `${e.name}.${f.name} is money and must be int (minor units) or decimal` });
      }
    });
  });
  const rule = m.approvalRule;
  if (rule) {
    const field = m.entities.find((e) => e.name === rule.entity)?.fields.find((f) => f.name === rule.field);
    if (!field) ctx.addIssue({ code: "custom", path: ["approvalRule", "field"], message: `Approval rule field ${rule.entity}.${rule.field} does not exist` });
    else if (!NUMERIC_TYPES.has(field.type)) ctx.addIssue({ code: "custom", path: ["approvalRule", "field"], message: `Approval rule field ${rule.entity}.${rule.field} must be numeric` });
    if (m.primaryUsers.includes(rule.approverRole) && m.primaryUsers.length === 1) {
      ctx.addIssue({ code: "custom", path: ["approvalRule", "approverRole"], message: "The approver role must differ from the only requesting role (four-eyes)" });
    }
  }
}

/** What a non-engineer fills in on /requests/new. */
export const toolRequestFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(/^[A-Za-z][A-Za-z0-9 \-]+$/, "Letters, numbers, spaces and dashes only")
      .refine((n) => slugify(n).length <= 60, "Too long once numbers are spelled out for the app id; shorten it"),
    purpose: z.string().trim().min(10, "Describe the purpose in a sentence or two").max(2000),
    primaryUsers: z.array(role).min(1, "Pick at least one primary role"),
    entities: z.array(entitySchema).min(1, "Add at least one entity").max(10),
    workflowStates: z.array(stateName).min(2, "At least two workflow states").max(12),
    approvalRule: approvalRuleSchema.nullish(),
    readOnlyRoles: z.array(role).default([]),
  })
  .superRefine(checkConsistency);
export type ToolRequestForm = z.output<typeof toolRequestFormSchema>;

export const RISK_TIERS = ["LOW", "HIGH"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** The generated app manifest. This is what the Devin session is asked to build. */
export const toolManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z-]{2,59}$/, "id is lowercase a-z and - only (it becomes src/apps/<id>)"),
    name: z.string().min(3).max(60),
    purpose: z.string().min(10).max(2000),
    riskTier: z.enum(RISK_TIERS),
    permissions: z.object({ read: z.string(), write: z.string(), approve: z.string().nullable() }),
    primaryUsers: z.array(role).min(1),
    readOnlyRoles: z.array(role),
    entities: z.array(entitySchema).min(1).max(10),
    workflow: z.object({ states: z.array(stateName).min(2).max(12), initial: stateName }),
    approvalRule: approvalRuleSchema.nullable(),
  })
  .strict()
  .superRefine((m, ctx) => {
    checkConsistency(m, ctx);
    const want = permissionsFor(m.id, !!m.approvalRule);
    for (const k of ["read", "write", "approve"] as const) {
      if (m.permissions[k] !== want[k]) ctx.addIssue({ code: "custom", path: ["permissions", k], message: `must be ${JSON.stringify(want[k])}` });
    }
    if (!m.workflow.states.includes(m.workflow.initial)) ctx.addIssue({ code: "custom", path: ["workflow", "initial"], message: "initial must be one of the states" });
    if (m.riskTier !== computeRiskTier(m)) ctx.addIssue({ code: "custom", path: ["riskTier"], message: `riskTier is computed and must be ${computeRiskTier(m)}` });
  });
export type ToolManifest = z.output<typeof toolManifestSchema>;

/** HIGH if any @pii/@money field or an approval rule exists. */
export function computeRiskTier(m: { entities: { fields: { pii?: boolean; money?: boolean }[] }[]; approvalRule?: unknown }): RiskTier {
  const sensitive = m.entities.some((e) => e.fields.some((f) => f.pii || f.money));
  return sensitive || m.approvalRule ? "HIGH" : "LOW";
}

/**
 * Why this manifest can't be built as a new app (its id or permission namespace is taken), or null.
 * Checked when a request is created and approved, not in the schema, so stored manifests stay valid after their app merges.
 */
export function newAppConflict(id: string, existing: { appIds: readonly string[]; permissions: readonly string[] }): string | null {
  if (existing.appIds.includes(id)) return `An app with id "${id}" already exists; pick another tool name.`;
  const ns = permissionsFor(id, false).read.split(":")[0]!;
  if (existing.permissions.some((p) => p.startsWith(`${ns}:`))) return `Permission namespace "${ns}" is already used in rbac.ts; pick another tool name.`;
  return null;
}

/** rbac.ts only accepts `[a-z_]+:[a-z_]+`, so the namespace is the app id with `-` replaced by `_`. */
export function permissionsFor(id: string, hasApproval: boolean) {
  const ns = id.replace(/-/g, "_");
  return { read: `${ns}:read`, write: `${ns}:write`, approve: hasApproval ? `${ns}:approve` : null };
}

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** App ids are a-z and `-` only, so digits are spelled out ("Refunds 2" -> "refunds-two") to keep names distinct. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[0-9]/g, (d) => `-${DIGIT_WORDS[Number(d)]}-`)
    .replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
}

export function formToManifest(form: ToolRequestForm): ToolManifest {
  const id = slugify(form.name);
  const approvalRule = form.approvalRule ?? null;
  return {
    id,
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    riskTier: computeRiskTier({ entities: form.entities, approvalRule }),
    permissions: permissionsFor(id, !!approvalRule),
    primaryUsers: [...form.primaryUsers],
    readOnlyRoles: form.readOnlyRoles.filter((r) => !form.primaryUsers.includes(r)),
    entities: form.entities.map((e) => ({ name: e.name, fields: e.fields.map((f) => ({ name: f.name, type: f.type, pii: f.pii, money: f.money })) })),
    workflow: { states: [...form.workflowStates], initial: form.workflowStates[0]! },
    approvalRule: approvalRule && { ...approvalRule },
  };
}

export function manifestToYaml(m: ToolManifest): string {
  return yaml.dump(m, { noRefs: true, lineWidth: 100, sortKeys: false });
}

export type ManifestParseResult = { ok: true; manifest: ToolManifest } | { ok: false; errors: string[] };

export function parseManifestYaml(text: string): ManifestParseResult {
  let data: unknown;
  try {
    data = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    return { ok: false, errors: [`YAML syntax: ${(e as Error).message.split("\n")[0]}`] };
  }
  const parsed = toolManifestSchema.safeParse(data);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

const human = (r: string) => r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() + (s.endsWith("s") ? "es" : "s");

/** Plain-English summary, e.g. "Support can request refunds; amounts over $500 require finance_approver; customerEmail is PII". */
export function summarizeManifest(m: ToolManifest): string {
  const parts = [`${list(m.primaryUsers.map(human))} can create and manage ${list(m.entities.map((e) => plural(e.name)))}`];
  if (m.readOnlyRoles.length) parts.push(`${list(m.readOnlyRoles.map(human))} can view them`);
  if (m.approvalRule) {
    const r = m.approvalRule;
    const field = m.entities.find((e) => e.name === r.entity)?.fields.find((f) => f.name === r.field);
    const amount = field?.money ? `$${r.threshold.toLocaleString("en-US")}` : String(r.threshold);
    parts.push(`${plural(r.field)} over ${amount} require ${r.approverRole}`);
  }
  const all = m.entities.flatMap((e) => e.fields);
  const pii = all.filter((f) => f.pii).map((f) => f.name);
  const money = all.filter((f) => f.money).map((f) => f.name);
  if (pii.length) parts.push(`${list(pii)} ${pii.length > 1 ? "are" : "is"} PII`);
  if (money.length) parts.push(`${list(money)} ${money.length > 1 ? "are" : "is"} money`);
  parts.push(`workflow ${m.workflow.states.join(" → ")}`);
  return `${parts.join("; ")}. Risk tier: ${m.riskTier}.`;
}

/** Deterministic ACU estimate used for budget checks and as the session's max_acu_limit. */
export function estimateAcus(m: ToolManifest): number {
  const fields = m.entities.reduce((n, e) => n + e.fields.length, 0);
  return 10 + 4 * m.entities.length + Math.ceil(fields / 2) + (m.approvalRule ? 5 : 0) + (m.riskTier === "HIGH" ? 5 : 0);
}
