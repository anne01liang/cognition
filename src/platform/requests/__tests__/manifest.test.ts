import { describe, expect, it } from "vitest";
import {
  computeRiskTier,
  estimateAcus,
  formToManifest,
  manifestToYaml,
  parseManifestYaml,
  summarizeManifest,
  toolRequestFormSchema,
  type ToolRequestForm,
} from "../manifest";

const refundsForm = (): ToolRequestForm =>
  toolRequestFormSchema.parse({
    name: "Refund Requests",
    purpose: "Support agents request refunds for customers; finance approves large ones.",
    primaryUsers: ["support"],
    readOnlyRoles: ["ops_lead"],
    entities: [
      {
        name: "Refund",
        fields: [
          { name: "customerEmail", type: "string", pii: true },
          { name: "amount", type: "decimal", money: true },
          { name: "reason", type: "text" },
        ],
      },
    ],
    workflowStates: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
    approvalRule: { entity: "Refund", field: "amount", threshold: 500, approverRole: "finance_approver" },
  });

const lowRiskForm = (): ToolRequestForm =>
  toolRequestFormSchema.parse({
    name: "Office Snacks",
    purpose: "Track snack restock requests for the office kitchen.",
    primaryUsers: ["ops_lead"],
    entities: [{ name: "SnackRequest", fields: [{ name: "item", type: "string" }, { name: "quantity", type: "int" }] }],
    workflowStates: ["OPEN", "ORDERED"],
  });

describe("manifest: deterministic conversion", () => {
  it("converts the form into a valid manifest, identically every time", () => {
    const a = manifestToYaml(formToManifest(refundsForm()));
    const b = manifestToYaml(formToManifest(refundsForm()));
    expect(a).toBe(b);
    const parsed = parseManifestYaml(a);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest).toMatchObject({
      id: "refund-requests",
      permissions: { read: "refund_requests:read", write: "refund_requests:write", approve: "refund_requests:approve" },
      workflow: { initial: "DRAFT" },
      riskTier: "HIGH",
    });
  });

  it("generates permissions in the rbac.ts format, whatever the tool name", () => {
    for (const name of ["Desk booking notes", "Refunds 2.0 (EU)", "chargeback-disputes"]) {
      const m = formToManifest({ ...refundsForm(), name });
      expect(m.id).toMatch(/^[a-z][a-z-]+$/);
      for (const p of [m.permissions.read, m.permissions.write, m.permissions.approve]) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
    expect(formToManifest({ ...refundsForm(), name: "Desk booking notes" }).permissions.read).toBe("desk_booking_notes:read");
    expect(formToManifest({ ...refundsForm(), name: "Refunds 2" }).id).toBe("refunds-two");
    expect(formToManifest({ ...refundsForm(), name: "Refunds 3" }).id).toBe("refunds-three");
    expect(formToManifest({ ...refundsForm(), name: "X 12" }).id).toBe("x-one-two");
  });

  it("summarizes in plain English", () => {
    const s = summarizeManifest(formToManifest(refundsForm()));
    expect(s).toContain("Support can create and manage refunds");
    expect(s).toContain("Ops lead can view them");
    expect(s).toContain("amounts over $500 require finance_approver");
    expect(s).toContain("customerEmail is PII");
    expect(s).toContain("Risk tier: HIGH");
  });

  it("estimates ACUs deterministically", () => {
    expect(estimateAcus(formToManifest(lowRiskForm()))).toBe(10 + 4 + 1);
    expect(estimateAcus(formToManifest(refundsForm()))).toBe(10 + 4 + 2 + 5 + 5);
  });
});

describe("manifest: validation rejects bad input", () => {
  const good = () => manifestToYaml(formToManifest(refundsForm()));

  it.each([
    ["YAML syntax", "id: [unclosed", /YAML syntax/],
    ["unknown top-level key", good() + "extraKey: 1\n", /Unrecognized key/i],
    ["bad id", good().replace("id: refund-requests", "id: Refund_Requests"), /^id:/m],
    ["downgraded risk tier", good().replace("riskTier: HIGH", "riskTier: LOW"), /riskTier is computed and must be HIGH/],
    ["permission outside namespace", good().replace("approve: refund_requests:approve", "approve: refund:approve"), /permissions\.approve/],
    ["approval rule on missing field", good().replace("field: amount", "field: total"), /approvalRule\.field.*does not exist/],
    ["money on a string field", good().replace("type: decimal", "type: string"), /must be int \(minor units\) or decimal/],
    ["unknown role", good().replace("- ops_lead", "- superuser"), /readOnlyRoles/],
    ["initial not a state", good().replace("initial: DRAFT", "initial: NOPE"), /workflow\.initial/],
  ])("%s", (_label, yamlText, pattern) => {
    const r = parseManifestYaml(yamlText);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(pattern);
  });

  it("rejects bad form input", () => {
    const base = { ...refundsForm() };
    expect(toolRequestFormSchema.safeParse({ ...base, entities: [] }).success).toBe(false);
    expect(toolRequestFormSchema.safeParse({ ...base, entities: [{ name: "refund", fields: [{ name: "x", type: "string" }] }] }).success).toBe(false);
    expect(toolRequestFormSchema.safeParse({ ...base, approvalRule: { ...base.approvalRule!, field: "reason" } }).success).toBe(false);
    // four-eyes at design time: the only requesting role cannot also be the approver
    expect(toolRequestFormSchema.safeParse({ ...base, approvalRule: { ...base.approvalRule!, approverRole: "support" } }).success).toBe(false);
  });

  it("does not execute YAML tags", () => {
    expect(parseManifestYaml('id: !!js/function "function(){}"').ok).toBe(false);
  });
});

describe("risk tier", () => {
  const base = { entities: [{ fields: [{}] }] };
  it("is LOW with no sensitive fields and no approval rule", () => {
    expect(computeRiskTier(base)).toBe("LOW");
    expect(formToManifest(lowRiskForm()).riskTier).toBe("LOW");
  });
  it("is HIGH with any @pii field", () => expect(computeRiskTier({ entities: [{ fields: [{}, { pii: true }] }] })).toBe("HIGH"));
  it("is HIGH with any @money field", () => expect(computeRiskTier({ entities: [{ fields: [{}] }, { fields: [{ money: true }] }] })).toBe("HIGH"));
  it("is HIGH with an approval rule", () => expect(computeRiskTier({ ...base, approvalRule: { field: "x" } })).toBe("HIGH"));
});
