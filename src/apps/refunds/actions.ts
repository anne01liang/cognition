"use server";

import { defineAction } from "@/platform/action";
import { decideApproval } from "@/platform/approval";
import { ConflictError, NotFoundError } from "@/platform/errors";
import { maskValue } from "@/platform/mask";
import { paging } from "@/platform/table";
import type { AppTx } from "@/platform/types";
import { REFUND } from "./permissions";
import { decideRefundSchema, listRefundsSchema, refundIdSchema, requestRefundSchema, resolveRefundEscalationSchema } from "./schemas";

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

/** What actions return: @pii fields masked; reveal goes through revealPii (audited). */
const publicView = (r: RefundRow) => ({ ...r, customerName: maskValue(r.customerName), accountNumber: maskValue(r.accountNumber) });

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
    if (before.status !== "PENDING") throw new ConflictError("Only PENDING refunds can be decided here.");
    const next = decideApproval(before, input.decision, session.userId);
    const after = await updateIfStatus(tx, before, { ...next, decisionReason: input.reason });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: after.id, status: after.status };
  },
});

/** ESCALATED refunds are resolved by holders of refund:escalation (ops_lead), still four-eyes. */
export const resolveRefundEscalation = defineAction({
  permission: REFUND.escalation,
  input: resolveRefundEscalationSchema,
  audit: { action: "refund.resolve_escalation", entityType: "Refund" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.refund.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("Refund");
    if (before.status !== "ESCALATED") throw new ConflictError("Only ESCALATED refunds can be resolved here.");
    const next = decideApproval(before, input.decision, session.userId);
    const after = await updateIfStatus(tx, before, { ...next, decisionReason: input.reason });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: after.id, status: after.status };
  },
});

/** Optimistic concurrency: only update if nobody changed the status meanwhile. */
async function updateIfStatus(tx: AppTx, before: RefundRow, data: Partial<Pick<RefundRow, "status" | "decidedById" | "decisionReason">>) {
  const { count } = await tx.refund.updateMany({ where: { id: before.id, status: before.status }, data });
  if (count !== 1) throw new ConflictError("This refund was changed by someone else. Reload and try again.");
  return (await tx.refund.findUnique({ where: { id: before.id } }))!;
}
