"use server";

import { defineAction } from "@/platform/action";
import { decideApproval, submitForApproval } from "@/platform/approval";
import { ConflictError, NotFoundError } from "@/platform/errors";
import { maskValue } from "@/platform/mask";
import { paging } from "@/platform/table";
import type { AppTx } from "@/platform/types";
import { KYC } from "./permissions";
import { caseIdSchema, createCaseSchema, decideCaseSchema, listCasesSchema, resolveEscalationSchema } from "./schemas";

type KycCaseRow = NonNullable<Awaited<ReturnType<AppTx["kycCase"]["findUnique"]>>>;

/** What goes into audit before/after: never raw PII. */
function auditView(c: KycCaseRow) {
  return {
    status: c.status,
    riskLevel: c.riskLevel,
    country: c.country,
    customerName: maskValue(c.customerName),
    documentNumber: maskValue(c.documentNumber),
    submittedById: c.submittedById,
    decidedById: c.decidedById,
    decisionReason: c.decisionReason,
  };
}

/** What goes to the UI: PII masked. Raw values only via revealPii. */
function publicView(c: KycCaseRow) {
  return { ...c, customerName: c.customerName, documentNumber: maskValue(c.documentNumber) };
}

export const listCases = defineAction({
  permission: KYC.read,
  input: listCasesSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q ? { OR: [{ customerName: { contains: input.q, mode: "insensitive" as const } }, { id: input.q }] } : {}),
    };
    const [rows, total] = await Promise.all([tx.kycCase.findMany({ where, ...paging(input) }), tx.kycCase.count({ where })]);
    return { rows: rows.map(publicView), total, params: input };
  },
});

export const getCase = defineAction({
  permission: KYC.read,
  input: caseIdSchema,
  audit: false,
  handler: async ({ input, tx }) => {
    const c = await tx.kycCase.findUnique({ where: { id: input.id } });
    if (!c) throw new NotFoundError("KYC case");
    return publicView(c);
  },
});

export const createCase = defineAction({
  permission: KYC.create,
  input: createCaseSchema,
  audit: { action: "kyc.case.create", entityType: "KycCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const c = await tx.kycCase.create({ data: { ...input, createdById: session.userId } });
    await recordAudit({ entityId: c.id, before: null, after: auditView(c) });
    return { id: c.id };
  },
});

export const submitCase = defineAction({
  permission: KYC.review,
  input: caseIdSchema,
  audit: { action: "kyc.case.submit", entityType: "KycCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.kycCase.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("KYC case");
    const next = submitForApproval(before, session.userId);
    const after = await updateIfStatus(tx, before, next);
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after) });
    return { id: before.id, status: after.status };
  },
});

export const decideCase = defineAction({
  permission: KYC.approve,
  input: decideCaseSchema,
  audit: { action: "kyc.case.decide", entityType: "KycCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.kycCase.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("KYC case");
    if (before.status !== "PENDING") throw new ConflictError("Only PENDING cases can be decided here.");
    const next = decideApproval(before, input.decision, session.userId);
    const after = await updateIfStatus(tx, before, { ...next, decisionReason: input.reason });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: before.id, status: after.status };
  },
});

export const resolveEscalation = defineAction({
  permission: KYC.escalation,
  input: resolveEscalationSchema,
  audit: { action: "kyc.case.resolve_escalation", entityType: "KycCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await tx.kycCase.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("KYC case");
    if (before.status !== "ESCALATED") throw new ConflictError("Only ESCALATED cases can be resolved here.");
    const next = decideApproval(before, input.decision, session.userId);
    const after = await updateIfStatus(tx, before, { ...next, decisionReason: input.reason });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: before.id, status: after.status };
  },
});

/** Optimistic concurrency: only update if nobody changed the status meanwhile. */
async function updateIfStatus(tx: AppTx, before: KycCaseRow, data: Partial<Pick<KycCaseRow, "status" | "submittedById" | "decidedById" | "decisionReason">>) {
  const { count } = await tx.kycCase.updateMany({ where: { id: before.id, status: before.status }, data });
  if (count !== 1) throw new ConflictError("This case was changed by someone else. Reload and try again.");
  return (await tx.kycCase.findUnique({ where: { id: before.id } }))!;
}
