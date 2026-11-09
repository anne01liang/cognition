import { z } from "zod";
import { tableQuery } from "@/platform/table";
import { RECOMMENDATIONS } from "./rules";

export const CASE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "ESCALATED"] as const;
export const COUNTRIES = ["AE", "BR", "CA", "DE", "ES", "FR", "GB", "IE", "IN", "IT", "MX", "NG", "NL", "SG", "US"] as const;
export const QUEUE_VIEWS = ["queue", "approvals"] as const;
export const DOCUMENT_TYPES = ["PASSPORT", "DRIVERS_LICENSE", "NATIONAL_ID", "PROOF_OF_ADDRESS", "SELFIE", "BANK_STATEMENT"] as const;

export const documentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), "Document URLs must be https"),
  uploadedAt: z.string().datetime(),
});
export const documentsSchema = z.array(documentSchema).max(50);
export type CaseDocument = z.infer<typeof documentSchema>;

/** queue = unassigned + mine; approvals = PENDING cases recommended by someone else. */
export const listQueueSchema = tableQuery(["slaDueAt", "riskScore", "submittedAt"]).extend({
  dir: z.enum(["asc", "desc"]).default("asc"),
  view: z.enum(QUEUE_VIEWS).default("queue"),
  status: z.enum(CASE_STATUSES).optional(),
  country: z.enum(COUNTRIES).optional(),
});

export const caseIdSchema = z.object({ id: z.string().min(1).max(64) });

const reason = z.string().trim().min(3, "A reason is required").max(500);

export const recommendSchema = z.object({
  id: z.string().min(1).max(64),
  recommendation: z.enum(RECOMMENDATIONS),
  reason,
});

export const finalizeSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["APPROVE", "REJECT"]),
  reason,
});
