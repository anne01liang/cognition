import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../../../../test/support/db";
import { permissionsForRoles } from "@/platform/rbac";
import { createCaseSchema } from "../schemas";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

const as = (userId: string, roles: string[]) => {
  session.current = { userId, username: userId, name: userId, roles, permissions: permissionsForRoles(roles) };
};

describe("kyc schemas", () => {
  it("rejects malformed document numbers and countries", () => {
    const r = createCaseSchema.safeParse({ customerName: "Jo", documentNumber: "bad doc", country: "USA", riskLevel: "LOW" });
    expect(r.success).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("kyc actions (integration)", async () => {
  const { createCase, submitCase, decideCase, getCase, resolveEscalation } = await import("../actions");
  const { revealPii } = await import("@/platform/pii/actions");
  const { db } = await import("@/platform/db");
  let id = "";

  beforeAll(async () => {
    as("u-alice", ["kyc_analyst"]);
    const res = await createCase({ customerName: "Test Person", documentNumber: "P99887766", country: "US", riskLevel: "HIGH" });
    if (!res.ok) throw new Error(res.error.message);
    id = res.data.id;
  });
  afterAll(() => db.$disconnect());

  it("never returns the raw document number", async () => {
    const res = await getCase({ id });
    expect(res.ok && res.data.documentNumber).toBe("•••••7766");
  });

  it("an analyst cannot approve (permission)", async () => {
    expect(await submitCase({ id })).toMatchObject({ ok: true, data: { status: "PENDING" } });
    expect(await decideCase({ id, decision: "APPROVE", reason: "looks fine" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("the submitter cannot approve even with approver rights (four-eyes, server-side)", async () => {
    as("u-alice", ["kyc_analyst", "kyc_approver"]);
    expect(await decideCase({ id, decision: "APPROVE", reason: "self approve" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: expect.stringContaining("Four-eyes") },
    });
  });

  it("a different approver can escalate, and ops_lead resolves", async () => {
    as("u-bob", ["kyc_approver"]);
    expect(await decideCase({ id, decision: "ESCALATE", reason: "high risk" })).toMatchObject({ ok: true, data: { status: "ESCALATED" } });
    as("u-olivia", ["ops_lead"]);
    expect(await resolveEscalation({ id, decision: "APPROVE", reason: "docs verified" })).toMatchObject({ ok: true, data: { status: "APPROVED" } });
  });

  it("every mutation wrote an audit event", async () => {
    const actions = (await db.auditEvent.findMany({ where: { entityId: id }, orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["kyc.case.create", "kyc.case.submit", "kyc.case.decide", "kyc.case.resolve_escalation"]);
  });

  it("PII reveal requires pii:reveal and is audited without the value", async () => {
    as("u-olivia", ["ops_lead"]);
    expect(await revealPii({ entityType: "KycCase", entityId: id, field: "documentNumber" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    as("u-bob", ["kyc_approver"]);
    expect(await revealPii({ entityType: "KycCase", entityId: id, field: "documentNumber" })).toEqual({ ok: true, data: { value: "P99887766" } });
    const ev = await db.auditEvent.findFirst({ where: { action: "pii.reveal", entityId: id } });
    expect(ev).toMatchObject({ actorId: "u-bob", entityType: "KycCase", after: { field: "documentNumber" } });
    expect(JSON.stringify(ev, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("P99887766");
  });
});
