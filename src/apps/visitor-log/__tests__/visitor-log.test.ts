import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../../../../test/support/db";
import { permissionsForRoles } from "@/platform/rbac";
import { createVisitNoteSchema, listVisitNotesSchema } from "../schemas";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

const as = (userId: string, roles: string[]) => {
  session.current = { userId, username: userId, name: userId, roles, permissions: permissionsForRoles(roles) };
};

describe("visitor-log schemas", () => {
  it("rejects empty, oversized or malformed input", () => {
    expect(createVisitNoteSchema.safeParse({ roomLabel: "", note: "ok" }).success).toBe(false);
    expect(createVisitNoteSchema.safeParse({ roomLabel: "Room <script>", note: "ok" }).success).toBe(false);
    expect(createVisitNoteSchema.safeParse({ roomLabel: "R".repeat(41), note: "ok" }).success).toBe(false);
    expect(createVisitNoteSchema.safeParse({ roomLabel: "Room 4B", note: "" }).success).toBe(false);
    expect(createVisitNoteSchema.safeParse({ roomLabel: "Room 4B", note: "x".repeat(281) }).success).toBe(false);
    expect(listVisitNotesSchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });

  it("accepts a room label and a short note", () => {
    expect(createVisitNoteSchema.parse({ roomLabel: " Room 4B ", note: " Projector checked. " })).toEqual({
      roomLabel: "Room 4B",
      note: "Projector checked.",
    });
  });

  it("only support holds visitor_log permissions, never admin", () => {
    expect([...permissionsForRoles(["support"])]).toEqual(expect.arrayContaining(["visitor_log:read", "visitor_log:write"]));
    for (const role of ["admin", "kyc_analyst", "kyc_approver", "finance_approver", "ops_lead"]) {
      expect([...permissionsForRoles([role])].filter((p) => p.startsWith("visitor_log:"))).toEqual([]);
    }
  });
});

describe.skipIf(!hasTestDb)("visitor-log actions (integration)", async () => {
  const { createVisitNote, submitVisitNote, getVisitNote, listVisitNotes } = await import("../actions");
  const { db } = await import("@/platform/db");
  let id = "";

  beforeAll(async () => {
    as("u-sam", ["support"]);
    const res = await createVisitNote({ roomLabel: "Room 4B", note: "Projector checked." });
    if (!res.ok) throw new Error(res.error.message);
    id = res.data.id;
  });
  afterAll(() => db.$disconnect());

  it("creates notes in DRAFT and lists them", async () => {
    expect(await getVisitNote({ id })).toMatchObject({ ok: true, data: { roomLabel: "Room 4B", status: "DRAFT", createdById: "u-sam" } });
    const list = await listVisitNotes({ q: "room 4b" });
    expect(list.ok && list.data.rows.map((r) => r.id)).toContain(id);
  });

  it("users without visitor_log permissions get FORBIDDEN", async () => {
    as("u-alice", ["kyc_analyst"]);
    expect(await listVisitNotes({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await getVisitNote({ id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await createVisitNote({ roomLabel: "Room 1", note: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await submitVisitNote({ id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    as("u-admin", ["admin"]);
    expect(await listVisitNotes({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("submits DRAFT -> SUBMITTED once; a second submit conflicts", async () => {
    as("u-sam", ["support"]);
    expect(await submitVisitNote({ id })).toMatchObject({ ok: true, data: { status: "SUBMITTED" } });
    expect(await submitVisitNote({ id })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await submitVisitNote({ id: "missing" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("every mutation wrote an audit event", async () => {
    const events = await db.auditEvent.findMany({ where: { entityId: id }, orderBy: { seq: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["visitor-log.visit_note.create", "visitor-log.visit_note.submit"]);
    expect(events.every((e) => e.entityType === "VisitNote" && e.actorId === "u-sam")).toBe(true);
    expect(events[1]).toMatchObject({ before: { status: "DRAFT" }, after: { status: "SUBMITTED", submittedById: "u-sam" } });
  });
});
