import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { permissionsForRoles } from "../rbac";

const session = vi.hoisted(() => ({ current: null as unknown }));
const writeAuditEvent = vi.hoisted(() => vi.fn());

vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));
vi.mock("@/platform/audit", () => ({ writeAuditEvent }));
vi.mock("@/platform/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ fake: "tx" }) } }));

const { defineAction } = await import("../action");

const alice = { userId: "alice", username: "alice", name: "Alice", roles: ["kyc_analyst"], permissions: permissionsForRoles(["kyc_analyst"]) };

describe("defineAction", () => {
  beforeEach(() => {
    session.current = alice;
    writeAuditEvent.mockReset();
  });

  const handler = vi.fn(async ({ recordAudit }: { recordAudit: (r: { entityId: string }) => Promise<void> }) => {
    await recordAudit({ entityId: "e1" });
    return "done";
  });
  const action = defineAction({
    permission: "kyc:create",
    input: z.object({ name: z.string().min(2) }),
    audit: { action: "kyc.case.create", entityType: "KycCase" },
    handler,
  });

  it("rejects unauthenticated callers before running the handler", async () => {
    session.current = null;
    expect(await action({ name: "ok" })).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects callers without the permission", async () => {
    const forbidden = defineAction({ permission: "kyc:approve", input: z.object({}), audit: false, handler });
    expect(await forbidden({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates input with Zod", async () => {
    expect(await action({ name: "x" })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", fieldErrors: { name: expect.any(Array) } } });
  });

  it("writes the audit event with the session actor inside the transaction", async () => {
    expect(await action({ name: "ok" })).toEqual({ ok: true, data: "done" });
    expect(writeAuditEvent).toHaveBeenCalledWith({ fake: "tx" }, expect.objectContaining({ actorId: "alice", action: "kyc.case.create", entityType: "KycCase", entityId: "e1" }));
  });

  it("fails closed when an audited action forgets recordAudit()", async () => {
    const forgetful = defineAction({ permission: "kyc:create", input: z.object({}), audit: { action: "a.b", entityType: "T" }, handler: async () => 1 });
    expect(await forgetful({})).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });

  it("does not leak unexpected error messages", async () => {
    const boom = defineAction({ permission: "kyc:read", input: z.object({}), audit: false, handler: async () => { throw new Error("db password is hunter2"); } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await boom({})).toEqual({ ok: false, error: { code: "INTERNAL", message: "Something went wrong." } });
    errSpy.mockRestore();
  });
});
