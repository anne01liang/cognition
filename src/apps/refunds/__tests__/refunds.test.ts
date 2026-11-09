import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../../../../test/support/db";
import { permissionsForRoles } from "@/platform/rbac";
import { requestRefundSchema } from "../schemas";
import { formatMoney } from "../money";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

const as = (userId: string, roles: string[]) => {
  session.current = { userId, username: userId, name: userId, roles, permissions: permissionsForRoles(roles) };
};

describe("refunds", () => {
  it("amounts are integer cents", () => {
    expect(requestRefundSchema.safeParse({ customerName: "Jo Doe", accountNumber: "12345678", amountCents: 10.5, reason: "dup" }).success).toBe(false);
    expect(requestRefundSchema.safeParse({ customerName: "Jo Doe", accountNumber: "12345678", amountCents: 1050, reason: "dup" }).success).toBe(true);
  });
  it("formats cents", () => {
    expect(formatMoney(12550)).toBe("$125.50");
  });
});

describe.skipIf(!hasTestDb)("refund actions (integration)", async () => {
  const { requestRefund, getRefund, decideRefund, resolveRefundEscalation } = await import("../actions");
  const { db } = await import("@/platform/db");
  let id = "";

  beforeAll(async () => {
    as("u-carol", ["support"]);
    const res = await requestRefund({ customerName: "Refund Person", accountNumber: "1234567890", amountCents: 4200, reason: "double charge" });
    if (!res.ok) throw new Error(res.error.message);
    id = res.data.id;
  });
  afterAll(() => db.$disconnect());

  it("never returns raw @pii fields", async () => {
    const res = await getRefund({ id });
    expect(res.ok && res.data.customerName).not.toContain("Refund Person");
    expect(res.ok && res.data.accountNumber).toBe("••••••7890");
  });

  it("support cannot decide; finance cannot resolve escalations", async () => {
    expect(await decideRefund({ id, decision: "APPROVE", reason: "self" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    as("u-dan", ["finance_approver"]);
    expect(await resolveRefundEscalation({ id, decision: "APPROVE", reason: "nope" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("finance escalates, then ops_lead resolves (escalated refunds are not stuck)", async () => {
    as("u-dan", ["finance_approver"]);
    expect(await decideRefund({ id, decision: "ESCALATE", reason: "large amount" })).toMatchObject({ ok: true, data: { status: "ESCALATED" } });
    expect(await decideRefund({ id, decision: "APPROVE", reason: "again" })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    as("u-olivia", ["ops_lead"]);
    expect(await resolveRefundEscalation({ id, decision: "APPROVE", reason: "verified" })).toMatchObject({ ok: true, data: { status: "APPROVED" } });
    const actions = (await db.auditEvent.findMany({ where: { entityId: id }, orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["refund.request", "refund.decide", "refund.resolve_escalation"]);
  });
});
