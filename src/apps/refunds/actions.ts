"use server";

import { defineAction } from "@/platform/action";
import { decideApproval } from "@/platform/approval";
import { ConflictError, ForbiddenError, NotFoundError } from "@/platform/errors";
import { maskValue } from "@/platform/mask";
import { paging } from "@/platform/table";
import type { AppTx } from "@/platform/types";
import { REFUND } from "./permissions";
import { decideRefundSchema, listRefundsSchema, refundIdSchema, requestRefundSchema } from "./schemas";

type RefundRow = NonNullable<Awaited<ReturnType<AppTx["refund"]["findUnique"]>>>;

function auditView(r: RefundRow) {
  return {
    status: r.status,
    amountCents: r.amountCents,
    currency: r.currency,
    customerName: maskValue(r.customerName),
    accountNumber: maskValue(r.accountNumber),
    submittedById: r.submittedById,
    decidedById: r.decidedById,
    decisionReason: r.decisionReason,
  };
}

const publicView = (r: RefundRow) => ({ ...r, accountNumber: maskValue(r.accountNumber) });

export const listRefunds = defineAction({
  permission: REFUND.read,
  input: listRefundsSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q ? { customerName: { contains: input.q, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([tx.refund.findMany({ where, ...paging(input) }), tx.refund.count({ where })]);
    return { rows: rows.map(publicView), total, params: input };
  },
});

export const getRefund = defineAction({
  permission: REFUND.read,
  input: refundIdSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const r = await tx.refund.findUnique({ where: { id: input.id } });
    if (!r) throw new NotFoundError("Refund");
    return publicView(r);
  },
});

/** Requesting a refund immediately creates a PENDING maker-checker request. */
export const requestRefund = defineAction({
  permission: REFUND.request,
  input: requestRefundSchema,
  audit: { action: "refund.request", entityType: "Refund" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const r = await tx.refund.create({ data: { ...input, status: "PENDING", submittedById: session.userId } });
    await recordAudit({ entityId: r.id, before: null, after: auditView(r), reason: input.reason });
    return { id: r.id };
  },
});

export const decideRefund = defineAction({
  permission: REFUND.approve,
  input: decideRefundSchema,
  audit: { action: "refund.decide", entityType: "Refund" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.refund.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Refund");
    if (before.status === "ESCALATED" && !session.permissions.has(REFUND.escalation)) throw new ForbiddenError(REFUND.escalation);
    const next = decideApproval(before, input.decision, session.userId);
    const { count } = await tx.refund.updateMany({
      where: { id: before.id, status: before.status },
      data: { ...next, decisionReason: input.reason },
    });
    if (count !== 1) throw new ConflictError("This refund was changed by someone else.");
    const after = (await tx.refund.findUnique({ where: { id: before.id } }))!;
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: after.id, status: after.status };
  },
});
