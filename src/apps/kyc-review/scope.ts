import { hasPermission, type SessionLike } from "@/platform/guard";
import { KYC_REVIEW } from "./permissions";

/** Analyst work queue: unassigned cases plus cases I claimed. */
export function reviewerScope(userId: string) {
  return { OR: [{ assignedTo: null }, { assignedTo: userId }] };
}

/** Approver work: cases awaiting a second review recommended by someone else. */
export function approverScope(userId: string) {
  return { status: "PENDING" as const, NOT: { submittedById: userId } };
}

/**
 * Every case this user may read (details, documents, PII reveal):
 * their queue for kyc:review, plus pending second reviews and cases they decided for kyc:approve.
 */
export function visibleCases(viewer: SessionLike) {
  const OR: object[] = [];
  if (hasPermission(viewer, KYC_REVIEW.review)) OR.push(reviewerScope(viewer.userId));
  if (hasPermission(viewer, KYC_REVIEW.approve)) OR.push(approverScope(viewer.userId), { decidedById: viewer.userId });
  return OR.length ? { OR } : { id: { in: [] as string[] } };
}
