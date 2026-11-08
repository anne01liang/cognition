import { z } from "zod";
import { tableQuery } from "@/platform/table";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const CASE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "ESCALATED"] as const;

export const createCaseSchema = z.object({
  customerName: z.string().trim().min(2).max(120).describe("Customer name"),
  documentNumber: z.string().trim().regex(/^[A-Z0-9-]{6,20}$/, "6-20 chars: A-Z, 0-9, -").describe("ID document number"),
  country: z.string().trim().regex(/^[A-Z]{2}$/, "ISO 3166 alpha-2, e.g. US").describe("Country"),
  riskLevel: z.enum(RISK_LEVELS).describe("Risk level"),
  notes: z.string().trim().max(1000).optional().describe("Notes"),
});

export const listCasesSchema = tableQuery(["createdAt", "riskLevel", "status"]).extend({
  status: z.enum(CASE_STATUSES).optional(),
});

export const caseIdSchema = z.object({ id: z.string().min(1).max(64) });

export const decideCaseSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["APPROVE", "REJECT", "ESCALATE"]),
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

export const resolveEscalationSchema = decideCaseSchema.extend({ decision: z.enum(["APPROVE", "REJECT"]) });
