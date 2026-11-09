import { afterAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../../../../test/support/db";
import { permissionsForRoles } from "@/platform/rbac";
import { maskValue } from "@/platform/mask";
import { isSlaBreached, requiresSecondPerson, slaDueFrom } from "../rules";
import { documentSchema, finalizeSchema, recommendSchema } from "../schemas";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

const as = (userId: string, roles: string[]) => {
  session.current = { userId, username: userId, name: userId, roles, permissions: permissionsForRoles(roles) };
};
const FORBIDDEN = { ok: false, error: { code: "FORBIDDEN" } };

describe("kyc-review rules and schemas", () => {
  it("needs a second person for riskScore >= 70 or any APPROVE / ESCALATE recommendation", () => {
    expect(requiresSecondPerson(69, "REJECT")).toBe(false);
    expect(requiresSecondPerson(70, "REJECT")).toBe(true);
    expect(requiresSecondPerson(5, "APPROVE")).toBe(true);
    expect(requiresSecondPerson(5, "ESCALATE")).toBe(true);
  });

  it("SLA is submittedAt + 48h and only open cases breach", () => {
    const submitted = new Date("2026-01-01T00:00:00Z");
    const due = slaDueFrom(submitted);
    expect(due.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    const later = new Date("2026-01-04T00:00:00Z");
    expect(isSlaBreached({ status: "PENDING", slaDueAt: due }, later)).toBe(true);
    expect(isSlaBreached({ status: "APPROVED", slaDueAt: due }, later)).toBe(false);
  });

  it("requires a reason and rejects non-https document URLs", () => {
    expect(recommendSchema.safeParse({ id: "x", recommendation: "APPROVE", reason: "  " }).success).toBe(false);
    expect(finalizeSchema.safeParse({ id: "x", decision: "ESCALATE", reason: "because" }).success).toBe(false);
    expect(documentSchema.safeParse({ type: "PASSPORT", url: "javascript:alert(1)", uploadedAt: new Date().toISOString() }).success).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("kyc-review actions (integration)", async () => {
  const actions = await import("../actions");
  const { claimCase, recommendCase, finalizeCase, getCase, listQueue } = actions;
  const { revealPii } = await import("@/platform/pii/actions");
  const { db } = await import("@/platform/db");
  afterAll(() => db.$disconnect());

  const SSN = "900-12-3456";
  const newCase = async (riskScore: number) => {
    const submittedAt = new Date();
    const c = await db.kycReviewCase.create({
      data: {
        customerName: "Test Customer",
        dateOfBirth: new Date("1990-01-02T00:00:00Z"),
        ssn: SSN,
        country: "US",
        riskScore,
        documents: [{ type: "PASSPORT", url: "https://docs.example.internal/t/id.pdf", uploadedAt: submittedAt.toISOString() }],
        submittedAt,
        slaDueAt: slaDueFrom(submittedAt),
      },
    });
    return c.id;
  };
  const auditCount = (entityId: string) => db.auditEvent.count({ where: { entityType: "KycReviewCase", entityId } });

  it("a user without kyc:review gets FORBIDDEN from every kyc-review server action", async () => {
    const id = await newCase(10);
    const exported = Object.entries(actions).filter(([, v]) => typeof v === "function") as [string, (i: unknown) => Promise<unknown>][];
    expect(exported.map(([name]) => name).sort()).toEqual(["claimCase", "finalizeCase", "getCase", "listQueue", "recommendCase"]);
    const input = { id, recommendation: "APPROVE", decision: "APPROVE", reason: "attempt" };
    for (const roles of [[], ["support"], ["admin"], ["ops_lead"], ["finance_approver"]]) {
      as("u-outsider", roles);
      for (const [name, fn] of exported) expect(await fn(input), `${name} as [${roles}]`).toMatchObject(FORBIDDEN);
    }
    // An approver lacks kyc:review: every analyst (kyc:review) action is FORBIDDEN for them too.
    as("u-bob", ["kyc_approver"]);
    expect(await claimCase({ id })).toMatchObject(FORBIDDEN);
    expect(await recommendCase({ id, recommendation: "APPROVE", reason: "attempt" })).toMatchObject(FORBIDDEN);
    expect(await auditCount(id)).toBe(0);
  });

  it("an analyst cannot finalize a high-risk case", async () => {
    const id = await newCase(85);
    as("u-alice", ["kyc_analyst"]);
    expect(await claimCase({ id })).toMatchObject({ ok: true });
    // A REJECT on a high-risk case is only a recommendation: it goes to PENDING, not REJECTED.
    expect(await recommendCase({ id, recommendation: "REJECT", reason: "sanctions hit" })).toMatchObject({ ok: true, data: { status: "PENDING" } });
    expect(await finalizeCase({ id, decision: "REJECT", reason: "finalize myself" })).toMatchObject(FORBIDDEN);
    as("u-frank", ["kyc_analyst"]);
    expect(await finalizeCase({ id, decision: "REJECT", reason: "another analyst" })).toMatchObject(FORBIDDEN);
    expect(await getCase({ id })).toMatchObject({ ok: true, data: { status: "PENDING", decidedById: null } });
  });

  it("a low-risk REJECT is final without a second person", async () => {
    const id = await newCase(20);
    as("u-alice", ["kyc_analyst"]);
    await claimCase({ id });
    expect(await recommendCase({ id, recommendation: "REJECT", reason: "expired passport" })).toMatchObject({ ok: true, data: { status: "REJECTED" } });
  });

  it("the same user cannot recommend and approve, even holding both permissions", async () => {
    const id = await newCase(20);
    as("u-dual", ["kyc_analyst", "kyc_approver"]);
    await claimCase({ id });
    expect(await recommendCase({ id, recommendation: "APPROVE", reason: "docs ok" })).toMatchObject({ ok: true, data: { status: "PENDING" } });
    expect(await finalizeCase({ id, decision: "APPROVE", reason: "self approve" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: expect.stringContaining("Four-eyes") },
    });
    as("u-bob", ["kyc_approver"]);
    expect(await finalizeCase({ id, decision: "APPROVE", reason: "concur" })).toMatchObject({ ok: true, data: { status: "APPROVED" } });
  });

  it("only the assigned analyst can recommend, and a claimed case leaves other analysts' queues", async () => {
    const id = await newCase(30);
    as("u-alice", ["kyc_analyst"]);
    await claimCase({ id });
    as("u-frank", ["kyc_analyst"]);
    expect(await recommendCase({ id, recommendation: "APPROVE", reason: "not mine" })).toMatchObject(FORBIDDEN);
    expect(await claimCase({ id })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await listQueue({ q: id })).toMatchObject({ ok: true, data: { total: 0 } });
    as("u-alice", ["kyc_analyst"]);
    expect(await listQueue({ q: id })).toMatchObject({ ok: true, data: { total: 1 } });
  });

  it("every mutation produces an audit event with before/after and reason, and no raw PII", async () => {
    const id = await newCase(75);
    as("u-alice", ["kyc_analyst"]);
    await claimCase({ id });
    await recommendCase({ id, recommendation: "ESCALATE", reason: "address mismatch" });
    as("u-bob", ["kyc_approver"]);
    await finalizeCase({ id, decision: "REJECT", reason: "risk appetite exceeded" });

    const events = await db.auditEvent.findMany({ where: { entityType: "KycReviewCase", entityId: id }, orderBy: { seq: "asc" } });
    expect(events.map((e) => [e.action, e.actorId])).toEqual([
      ["kyc-review.case.claim", "u-alice"],
      ["kyc-review.case.recommend", "u-alice"],
      ["kyc-review.case.finalize", "u-bob"],
    ]);
    expect(events.map((e) => [(e.before as { status: string }).status, (e.after as { status: string }).status, e.reason])).toEqual([
      ["DRAFT", "DRAFT", "Claimed for review"],
      ["DRAFT", "PENDING", "address mismatch"],
      ["PENDING", "REJECTED", "risk appetite exceeded"],
    ]);
    const json = JSON.stringify(events, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).not.toContain(SSN);
    expect(json).not.toContain("Test Customer");
  });

  it("SSN is masked; reveal requires pii:reveal and is audited without the value", async () => {
    const id = await newCase(40);
    as("u-alice", ["kyc_analyst"]);
    expect(await getCase({ id })).toMatchObject({ ok: true, data: { ssn: maskValue(SSN), customerName: maskValue("Test Customer") } });
    as("u-olivia", ["ops_lead"]);
    expect(await revealPii({ entityType: "KycReviewCase", entityId: id, field: "ssn" })).toMatchObject(FORBIDDEN);
    as("u-alice", ["kyc_analyst"]);
    expect(await revealPii({ entityType: "KycReviewCase", entityId: id, field: "ssn" })).toEqual({ ok: true, data: { value: SSN } });
    const ev = await db.auditEvent.findFirst({ where: { action: "pii.reveal", entityId: id } });
    expect(ev).toMatchObject({ actorId: "u-alice", entityType: "KycReviewCase", after: { field: "ssn" } });
    expect(JSON.stringify(ev, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(SSN);
  });
});
