"use server";

import { defineAction } from "@/platform/action";
import { decideApproval, submitForApproval } from "@/platform/approval";
import { ActionError, ConflictError, NotFoundError } from "@/platform/errors";
import { maskValue } from "@/platform/mask";
import { paging } from "@/platform/table";
import type { AppTx } from "@/platform/types";
import { KYC_REVIEW } from "./permissions";
import { isoDate, isSlaBreached, requiresSecondPerson } from "./rules";
import { caseIdSchema, documentsSchema, finalizeSchema, listQueueSchema, recommendSchema } from "./schemas";

type CaseRow = NonNullable<Awaited<ReturnType<AppTx["kycReviewCase"]["findUnique"]>>>;
type Mutable = Partial<
  Pick<CaseRow, "status" | "assignedTo" | "submittedById" | "decidedById" | "decisionReason" | "recommendation" | "recommendationReason">
>;

/** Audit before/after: workflow fields only, never PII. */
function auditView(c: CaseRow) {
  return {
    status: c.status,
    riskScore: c.riskScore,
    country: c.country,
    assignedTo: c.assignedTo,
    recommendation: c.recommendation,
    recommendationReason: c.recommendationReason,
    submittedById: c.submittedById,
    decidedById: c.decidedById,
    decisionReason: c.decisionReason,
  };
}

/** What goes to the UI: @pii masked (reveal via revealPii, audited), documents validated. */
function publicView(c: CaseRow) {
  const docs = documentsSchema.safeParse(c.documents);
  return {
    ...c,
    customerName: maskValue(c.customerName),
    dateOfBirth: maskValue(isoDate(c.dateOfBirth)),
    ssn: maskValue(c.ssn),
    documents: docs.success ? docs.data : [],
    slaBreached: isSlaBreached(c),
  };
}

async function load(tx: AppTx, id: string) {
  const c = await tx.kycReviewCase.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("KYC case");
  return c;
}

/** Optimistic concurrency: only update if status and assignee are unchanged. */
async function updateIfUnchanged(tx: AppTx, before: CaseRow, data: Mutable) {
  const { count } = await tx.kycReviewCase.updateMany({
    where: { id: before.id, status: before.status, assignedTo: before.assignedTo },
    data,
  });
  if (count !== 1) throw new ConflictError("This case was changed by someone else. Reload and try again.");
  return (await tx.kycReviewCase.findUnique({ where: { id: before.id } }))!;
}

export const listQueue = defineAction({
  permission: KYC_REVIEW.queue,
  input: listQueueSchema,
  audit: false,
  handler: async ({ input, session, tx }) => {
    const scope =
      input.view === "approvals"
        ? { status: "PENDING" as const, NOT: { submittedById: session.userId } }
        : { OR: [{ assignedTo: null }, { assignedTo: session.userId }], ...(input.status ? { status: input.status } : {}) };
    const where = { ...scope, ...(input.country ? { country: input.country } : {}), ...(input.q ? { id: input.q } : {}) };
    const [rows, total] = await Promise.all([
      tx.kycReviewCase.findMany({ where, ...paging(input) }),
      tx.kycReviewCase.count({ where }),
    ]);
    return { rows: rows.map(publicView), total, params: input };
  },
});

export const getCase = defineAction({
  permission: KYC_REVIEW.queue,
  input: caseIdSchema,
  audit: false,
  handler: async ({ input, tx }) => publicView(await load(tx, input.id)),
});

export const claimCase = defineAction({
  permission: KYC_REVIEW.review,
  input: caseIdSchema,
  audit: { action: "kyc-review.case.claim", entityType: "KycReviewCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await load(tx, input.id);
    if (before.status !== "DRAFT" || before.assignedTo !== null) {
      throw new ConflictError("Only unassigned cases awaiting review can be claimed.");
    }
    const after = await updateIfUnchanged(tx, before, { assignedTo: session.userId });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: "Claimed for review" });
    return { id: before.id, assignedTo: after.assignedTo };
  },
});

export const recommendCase = defineAction({
  permission: KYC_REVIEW.review,
  input: recommendSchema,
  audit: { action: "kyc-review.case.recommend", entityType: "KycReviewCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await load(tx, input.id);
    if (before.assignedTo !== session.userId) {
      throw new ActionError("FORBIDDEN", "Only the analyst assigned to this case can recommend. Claim it first.");
    }
    const recommendation = { recommendation: input.recommendation, recommendationReason: input.reason };
    // Maker-checker path: DRAFT -> PENDING via the platform helper, finalized by a different kyc:approve holder.
    // Single-person path (low-risk REJECT only): the analyst's recommendation is the final decision.
    let next: Mutable;
    if (requiresSecondPerson(before.riskScore, input.recommendation)) {
      next = { ...submitForApproval(before, session.userId), ...recommendation };
    } else {
      if (before.status !== "DRAFT") throw new ConflictError(`Cannot recommend on a case in status ${before.status}.`);
      next = { status: "REJECTED", submittedById: session.userId, decidedById: session.userId, decisionReason: input.reason, ...recommendation };
    }
    const after = await updateIfUnchanged(tx, before, next);
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: before.id, status: after.status };
  },
});

export const finalizeCase = defineAction({
  permission: KYC_REVIEW.approve,
  input: finalizeSchema,
  audit: { action: "kyc-review.case.finalize", entityType: "KycReviewCase" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const before = await load(tx, input.id);
    if (before.status !== "PENDING") throw new ConflictError("Only cases awaiting a second review can be finalized.");
    const next = decideApproval(before, input.decision, session.userId); // throws if approver == recommending analyst
    const after = await updateIfUnchanged(tx, before, { ...next, decisionReason: input.reason });
    await recordAudit({ entityId: before.id, before: auditView(before), after: auditView(after), reason: input.reason });
    return { id: before.id, status: after.status };
  },
});
