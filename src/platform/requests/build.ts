import "server-only";
import type { ToolRequestStatus } from "@prisma/client";
import { writeAuditEvent } from "../audit";
import { db } from "../db";
import { DevinApiError, buildPrompt, createDevinSession } from "./devin";
import { auditSnapshot } from "./lifecycle";

/**
 * Starts the Devin build for an APPROVED request. Called from defineAction's afterCommit, so the approval is
 * already committed and the Devin API call holds no DB transaction open. The result (BUILDING or FAILED) is
 * recorded with a compare-and-set on APPROVED plus an audit event in a second, short transaction.
 * Never throws: a request left in APPROVED (e.g. the process died mid-call) can be retried with
 * retryToolRequestBuild; `idempotent: true` on session creation stops a retry from starting a second session.
 */
export async function startBuild(id: string, actorId: string): Promise<ToolRequestStatus> {
  const r = await db.toolRequest.findUnique({ where: { id } });
  if (!r) throw new Error(`Tool request ${id} not found`);
  if (r.status !== "APPROVED") return r.status;

  const prompt = buildPrompt({ id: r.id, name: r.toolName, manifestYaml: r.manifestYaml });
  let data;
  try {
    const s = await createDevinSession({ requestId: r.id, title: `tool-request/${r.id}: ${r.toolName}`, prompt, maxAcuLimit: r.estimatedAcus });
    data = { status: "BUILDING" as const, devinSessionId: s.sessionId, devinSessionUrl: s.url, buildStartedAt: new Date() };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
    // acusUsed = 0 only when no session can exist; timeouts and 5xx keep the estimate charged to the budget.
    const notStarted = err instanceof DevinApiError && err.definitive;
    data = { status: "FAILED" as const, lastError: `Could not start Devin session: ${message}`, acusUsed: notStarted ? 0 : null };
  }

  return db.$transaction(async (tx) => {
    const res = await tx.toolRequest.updateMany({ where: { id, status: "APPROVED" }, data });
    const next = await tx.toolRequest.findUniqueOrThrow({ where: { id } });
    if (res.count !== 1) return next.status; // a concurrent start already recorded the outcome
    await writeAuditEvent(tx, {
      actorId,
      action: "tool-request.build-start",
      entityType: "ToolRequest",
      entityId: id,
      before: auditSnapshot(r),
      after: { ...auditSnapshot(next), devinSessionUrl: next.devinSessionUrl, lastError: next.lastError },
    });
    return next.status;
  });
}
