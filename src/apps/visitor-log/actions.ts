"use server";

import { defineAction } from "@/platform/action";
import { ConflictError, NotFoundError } from "@/platform/errors";
import { paging } from "@/platform/table";
import { VISITOR_LOG } from "./permissions";
import { createVisitNoteSchema, listVisitNotesSchema, visitNoteIdSchema } from "./schemas";
import type { AppTx } from "@/platform/types";

type VisitNoteRow = NonNullable<Awaited<ReturnType<AppTx["visitNote"]["findUnique"]>>>;

/** What goes into audit before/after. VisitNote has no @pii or @money fields. */
function auditView(n: VisitNoteRow) {
  return { roomLabel: n.roomLabel, note: n.note, status: n.status, submittedById: n.submittedById };
}

export const listVisitNotes = defineAction({
  permission: VISITOR_LOG.read,
  input: listVisitNotesSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q ? { OR: [{ roomLabel: { contains: input.q, mode: "insensitive" as const } }, { id: input.q }] } : {}),
    };
    const [rows, total] = await Promise.all([tx.visitNote.findMany({ where, ...paging(input) }), tx.visitNote.count({ where })]);
    return { rows, total, params: input };
  },
});

export const getVisitNote = defineAction({
  permission: VISITOR_LOG.read,
  input: visitNoteIdSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const row = await tx.visitNote.findUnique({ where: { id: input.id } });
    if (!row) throw new NotFoundError("Visit note");
    return row;
  },
});

export const createVisitNote = defineAction({
  permission: VISITOR_LOG.write,
  input: createVisitNoteSchema,
  audit: { action: "visitor-log.visit_note.create", entityType: "VisitNote" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const row = await tx.visitNote.create({ data: { ...input, createdById: session.userId } });
    await recordAudit({ entityId: row.id, before: null, after: auditView(row) });
    return { id: row.id };
  },
});

export const submitVisitNote = defineAction({
  permission: VISITOR_LOG.write,
  input: visitNoteIdSchema,
  audit: { action: "visitor-log.visit_note.submit", entityType: "VisitNote" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.visitNote.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Visit note");
    if (before.status !== "DRAFT") throw new ConflictError("Only DRAFT notes can be submitted.");
    const { count } = await tx.visitNote.updateMany({
      where: { id: before.id, status: before.status },
      data: { status: "SUBMITTED", submittedById: session.userId },
    });
    if (count !== 1) throw new ConflictError("This note was changed by someone else. Reload and try again.");
    const after = (await tx.visitNote.findUnique({ where: { id: before.id } }))!;
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after) });
    return { id: after.id, status: after.status };
  },
});
