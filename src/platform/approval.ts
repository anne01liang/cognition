import { ActionError } from "./errors";

/**
 * Reusable maker-checker (four-eyes) state machine.
 *
 *   DRAFT --submit--> PENDING --approve--> APPROVED
 *                        |------reject---> REJECTED
 *                        '-----escalate--> ESCALATED --approve/reject--> APPROVED | REJECTED
 *
 * Rule: the decider must never be the submitter (also applies to escalation
 * resolution). Which *permission* may decide is the app's choice, enforced by
 * defineAction; this module enforces the state + four-eyes rules.
 */

export type ApprovalStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";
export type Decision = "APPROVE" | "REJECT" | "ESCALATE";

export interface Approvable {
  status: ApprovalStatus;
  submittedById: string | null;
}

export class FourEyesViolationError extends ActionError {
  constructor() {
    super("FORBIDDEN", "Four-eyes rule: you cannot decide on a request you submitted.");
  }
}

export class InvalidTransitionError extends ActionError {
  constructor(from: ApprovalStatus, decision: Decision | "SUBMIT") {
    super("CONFLICT", `Cannot ${decision.toLowerCase()} a request in status ${from}.`);
  }
}

const TRANSITIONS: Record<ApprovalStatus, Partial<Record<Decision, ApprovalStatus>>> = {
  DRAFT: {},
  PENDING: { APPROVE: "APPROVED", REJECT: "REJECTED", ESCALATE: "ESCALATED" },
  ESCALATED: { APPROVE: "APPROVED", REJECT: "REJECTED" },
  APPROVED: {},
  REJECTED: {},
};

export function submitForApproval(current: Approvable, actorId: string) {
  if (current.status !== "DRAFT") throw new InvalidTransitionError(current.status, "SUBMIT");
  return { status: "PENDING" as const, submittedById: actorId };
}

export function decideApproval(current: Approvable, decision: Decision, actorId: string) {
  if (!current.submittedById) throw new InvalidTransitionError(current.status, decision);
  if (current.submittedById === actorId) throw new FourEyesViolationError();
  const next = TRANSITIONS[current.status][decision];
  if (!next) throw new InvalidTransitionError(current.status, decision);
  return { status: next, decidedById: actorId };
}

export function isAwaitingDecision(status: ApprovalStatus): boolean {
  return status === "PENDING" || status === "ESCALATED";
}
