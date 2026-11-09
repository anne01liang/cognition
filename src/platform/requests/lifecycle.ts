import "server-only";
import type { ApprovalStatus } from "../approval";
import type { FullTx } from "../db";
import { hasPermission } from "../guard";
import type { AppSession } from "../session";
import { monthStart } from "./config";
import type { SessionSnapshot } from "./devin";

export type ToolRequestRow = NonNullable<Awaited<ReturnType<FullTx["toolRequest"]["findUnique"]>>>;
type BuildFields = Pick<ToolRequestRow, "status" | "prUrl" | "acusUsed" | "lastError">;

/**
 * Statuses whose estimate (or actual usage, if higher) counts against the team's monthly budget.
 * A FAILED request is free only if its session definitely never started (no session id and acusUsed = 0).
 */
export const BUDGETED_STATUSES = ["APPROVED", "BUILDING", "PR_OPEN", "MERGED", "FAILED"] as const;

/** Fields safe for audit before/after. */
export const auditSnapshot = (r: ToolRequestRow) => ({
  status: r.status,
  riskTier: r.riskTier,
  estimatedAcus: r.estimatedAcus,
  devinSessionId: r.devinSessionId,
  prUrl: r.prUrl,
  acusUsed: r.acusUsed,
});

/** Adapter: the request lifecycle in the platform maker-checker vocabulary (SUBMITTED = PENDING). */
export function asApprovable(r: Pick<ToolRequestRow, "status" | "submittedById">): { status: ApprovalStatus; submittedById: string | null } {
  const status: ApprovalStatus = r.status === "DRAFT" ? "DRAFT" : r.status === "SUBMITTED" ? "PENDING" : "APPROVED";
  return { status, submittedById: r.submittedById };
}

/** Requesters see their own requests; approvers see all. */
export function canSee(session: AppSession, r: Pick<ToolRequestRow, "requestedById">) {
  return r.requestedById === session.userId || hasPermission(session, "tools:approve");
}

export async function teamAcusThisMonth(tx: FullTx, team: string, now = new Date()): Promise<number> {
  const rows = await tx.toolRequest.findMany({
    where: {
      team,
      approvedAt: { gte: monthStart(now) },
      status: { in: [...BUDGETED_STATUSES] },
    },
    select: { status: true, devinSessionId: true, estimatedAcus: true, acusUsed: true },
  });
  const neverStarted = (r: (typeof rows)[number]) => r.status === "FAILED" && r.devinSessionId === null && r.acusUsed === 0;
  return rows.filter((r) => !neverStarted(r)).reduce((n, r) => n + Math.max(r.estimatedAcus, r.acusUsed ?? 0), 0);
}

/**
 * Pure: the fields to persist after polling a Devin session, or null if nothing changed.
 * `transition` is false when only the ACU counter moved (not audited).
 */
export function nextBuildState(r: BuildFields, s: SessionSnapshot): { data: BuildFields; transition: boolean } | null {
  if (r.status !== "BUILDING" && r.status !== "PR_OPEN") return null;
  const status = r.status === "PR_OPEN" && s.status === "BUILDING" ? "PR_OPEN" : s.status;
  const data = { status, prUrl: s.prUrl ?? r.prUrl, acusUsed: s.acusUsed ?? r.acusUsed, lastError: s.error ?? r.lastError };
  const transition = data.status !== r.status || data.prUrl !== r.prUrl || data.lastError !== r.lastError;
  if (!transition && data.acusUsed === r.acusUsed) return null;
  return { data, transition };
}
