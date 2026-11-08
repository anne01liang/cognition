/**
 * Runs against TEST_DATABASE_URL (schema "test", reset by globalSetup).
 * Proves: append-only trigger, concurrent appends keep the chain valid,
 * tampering is detected by verifyAuditChain, rollback drops the audit row.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { hasTestDb } from "../../../test/support/db";
import { permissionsForRoles } from "../rbac";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

describe.skipIf(!hasTestDb)("audit log (integration)", async () => {
  const { db } = await import("../db");
  const { writeAuditEvent, verifyAuditChain } = await import("../audit");
  const { defineAction } = await import("../action");

  afterAll(() => db.$disconnect());

  let baseline = 0;

  it("serialises 20 concurrent appends into a valid, gap-free chain", async () => {
    baseline = await db.auditEvent.count();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.$transaction((tx) => writeAuditEvent(tx, { actorId: "test", action: "test.concurrent", entityType: "Test", entityId: String(i), after: { i } })),
      ),
    );
    const result = await verifyAuditChain(db);
    expect(result).toEqual({ ok: true, checked: baseline + 20, firstBrokenSeq: null });
  });

  it("rejects UPDATE and DELETE via trigger", async () => {
    await expect(db.$executeRawUnsafe(`UPDATE "AuditEvent" SET reason = 'x' WHERE seq = 1`)).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE seq = 1`)).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("rolls back the audit row when the handler throws after recordAudit()", async () => {
    session.current = { userId: "u-alice", permissions: permissionsForRoles(["kyc_analyst"]) };
    const before = await db.auditEvent.count();
    const failing = defineAction({
      permission: "kyc:create",
      input: z.object({}),
      audit: { action: "test.rollback", entityType: "Test" },
      handler: async ({ recordAudit }) => {
        await recordAudit({ entityId: "x" });
        throw new Error("boom after audit");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await failing({})).ok).toBe(false);
    spy.mockRestore();
    expect(await db.auditEvent.count()).toBe(before);
  });

  it("detects a row tampered with raw SQL (trigger disabled)", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_no_update_delete`);
      await tx.$executeRawUnsafe(`UPDATE "AuditEvent" SET after = '{"i": 999}'::jsonb WHERE seq = ${baseline + 7}`);
      await tx.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_no_update_delete`);
    });
    expect(await verifyAuditChain(db)).toEqual({ ok: false, checked: baseline + 6, firstBrokenSeq: String(baseline + 7) });
  });
});
