import { z } from "zod";
import { tableQuery } from "@/platform/table";

export const REFUND_STATUSES = ["PENDING", "APPROVED", "REJECTED", "ESCALATED"] as const;

export const requestRefundSchema = z.object({
  customerName: z.string().trim().min(2).max(120).describe("Customer name"),
  accountNumber: z.string().trim().regex(/^[0-9]{8,17}$/, "8-17 digits").describe("Account number"),
  amountCents: z.number().int().positive().max(1_000_000_00).describe("Amount (cents)"),
  reason: z.string().trim().min(3).max(500).describe("Reason"),
});

export const listRefundsSchema = tableQuery(["createdAt", "amountCents", "status"]).extend({
  status: z.enum(REFUND_STATUSES).optional(),
});

export const refundIdSchema = z.object({ id: z.string().min(1).max(64) });

export const decideRefundSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["APPROVE", "REJECT", "ESCALATE"]),
  reason: z.string().trim().min(3, "A reason is required").max(500),
});
