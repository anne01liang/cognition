import { z } from "zod";
import { tableQuery } from "@/platform/table";

/** Workflow states from the tool-request manifest. No approve permission exists, so only DRAFT -> SUBMITTED is reachable. */
export const VISIT_NOTE_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;

export const createVisitNoteSchema = z.object({
  roomLabel: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/, "1-40 chars: letters, digits, space, . _ -")
    .describe("Room label"),
  note: z.string().trim().min(1).max(280).describe("Note (no names or personal information)"),
});

export const listVisitNotesSchema = tableQuery(["createdAt", "roomLabel", "status"]).extend({
  status: z.enum(VISIT_NOTE_STATUSES).optional(),
});

export const visitNoteIdSchema = z.object({ id: z.string().min(1).max(64) });
