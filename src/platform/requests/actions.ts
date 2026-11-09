"use server";

/**
 * Tool Requests server actions (platform feature, not an app).
 * Lifecycle: DRAFT -> SUBMITTED -> APPROVED -> BUILDING -> PR_OPEN -> MERGED | FAILED.
 * The approval gate reuses the platform maker-checker helper (four-eyes).
 */
import { z } from "zod";
import { defineAction } from "../action";
import { decideApproval, submitForApproval } from "../approval";
import { writeAuditEvent } from "../audit";
import type { FullTx } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ActionError } from "../errors";
import { hasPermission } from "../guard";
import type { AppSession } from "../session";
import { teamBudgets, teamFor } from "./config";
import { startBuild } from "./build";
import { buildPrompt, devinMode, getDevinSession } from "./devin";
import { asApprovable, auditSnapshot, canSee, nextBuildState, teamAcusThisMonth, type ToolRequestRow } from "./lifecycle";
import { estimateAcus, parseManifestYaml, toolRequestFormSchema } from "./manifest";

const ENTITY = "ToolRequest";
const TEAM_BUDGET_LOCK = 746_174_002;
const idInput = z.object({ id: z.string().min(1).max(64) });
const snap = auditSnapshot;
type Row = ToolRequestRow;

async function load(tx: FullTx, id: string, session: AppSession) {
  const r = await tx.toolRequest.findUnique({ where: { id } });
  if (!r || !canSee(session, r)) throw new NotFoundError("Tool request");
  return r;
}

/** Compare-and-set on status so concurrent transitions cannot both win. */
async function transition(tx: FullTx, r: Row, data: Parameters<FullTx["toolRequest"]["updateMany"]>[0]["data"]) {
  const res = await tx.toolRequest.updateMany({ where: { id: r.id, status: r.status }, data });
  if (res.count !== 1) throw new ConflictError("This request changed in the meantime. Reload and try again.");
  return (await tx.toolRequest.findUnique({ where: { id: r.id } }))!;
}

// ---------------------------------------------------------------- create / submit

export const createToolRequest = defineAction({
  permission: "tools:request",
  input: z.object({ form: toolRequestFormSchema, manifestYaml: z.string().min(1).max(50_000) }),
  audit: { action: "tool-request.create", entityType: ENTITY },
  handler: async ({ input, session, tx, recordAudit }) => {
    const parsed = parseManifestYaml(input.manifestYaml);
    if (!parsed.ok) throw new ActionError("INVALID_INPUT", "The manifest is invalid.", { manifestYaml: parsed.errors });
    const m = parsed.manifest;
    const r = await tx.toolRequest.create({
      data: {
        toolName: m.name,
        team: teamFor(session.roles),
        riskTier: m.riskTier,
        form: input.form,
        manifestYaml: input.manifestYaml,
        estimatedAcus: estimateAcus(m),
        requestedById: session.userId,
      },
    });
    await recordAudit({ entityId: r.id, before: null, after: { ...snap(r), toolName: r.toolName, team: r.team, manifestYaml: r.manifestYaml } });
    return { id: r.id };
  },
});

export const submitToolRequest = defineAction({
  permission: "tools:request",
  input: idInput,
  audit: { action: "tool-request.submit", entityType: ENTITY },
  handler: async ({ input, session, tx, recordAudit }) => {
    const r = await load(tx as FullTx, input.id, session);
    if (r.requestedById !== session.userId) throw new ForbiddenError("tools:request (only the requester can submit)");
    const { submittedById } = submitForApproval(asApprovable(r), session.userId);
    const next = await transition(tx as FullTx, r, { status: "SUBMITTED", submittedById });
    await recordAudit({ entityId: r.id, before: snap(r), after: snap(next) });
    return { status: next.status };
  },
});

// ---------------------------------------------------------------- approve -> start Devin

export const approveToolRequest = defineAction({
  permission: "tools:approve",
  input: idInput.extend({ reason: z.string().trim().max(500).optional() }),
  audit: { action: "tool-request.approve", entityType: ENTITY },
  handler: async ({ input, session, tx: appTx, recordAudit }) => {
    const tx = appTx as FullTx;
    const r = await load(tx, input.id, session);
    if (r.status !== "SUBMITTED") throw new ConflictError(`Only SUBMITTED requests can be approved (this one is ${r.status}).`);
    const { decidedById } = decideApproval(asApprovable(r), "APPROVE", session.userId); // four-eyes

    // Serialize approvals per team so two concurrent approvals cannot both pass the budget check.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${TEAM_BUDGET_LOCK}::int, hashtext(${r.team}::text))::text AS locked`;
    const budget = teamBudgets()[r.team] ?? 0;
    const used = await teamAcusThisMonth(tx, r.team);
    if (used + r.estimatedAcus > budget) {
      throw new ConflictError(`Monthly ACU budget for team "${r.team}" would be exceeded: ${used} used + ${r.estimatedAcus} estimated > ${budget}.`);
    }

    const prompt = buildPrompt({ id: r.id, name: r.toolName, manifestYaml: r.manifestYaml });
    const approved = await transition(tx, r, { status: "APPROVED", decidedById, approvedAt: new Date() });
    await recordAudit({
      entityId: r.id,
      before: snap(r),
      after: { ...snap(approved), budget: { team: r.team, usedBefore: used, limit: budget }, devinMode: devinMode(), prompt },
      reason: input.reason ?? null,
    });
    return { status: approved.status as Row["status"], id: r.id };
  },
  // The Devin API call happens only after the approval has committed (see build.ts).
  afterCommit: async ({ result, session }) => ({ status: await startBuild(result.id, session.userId), id: result.id }),
});

/** Re-runs the build start for a request stuck in APPROVED (e.g. the server died during the Devin API call). */
export const retryToolRequestBuild = defineAction({
  permission: "tools:approve",
  input: idInput,
  audit: { action: "tool-request.build-retry", entityType: ENTITY },
  handler: async ({ input, session, tx: appTx, recordAudit }) => {
    const tx = appTx as FullTx;
    const r = await load(tx, input.id, session);
    if (r.status !== "APPROVED") throw new ConflictError(`Only APPROVED requests can be retried (this one is ${r.status}).`);
    await recordAudit({ entityId: r.id, before: snap(r), after: snap(r), reason: "Retry starting the Devin build" });
    return { status: r.status as Row["status"], id: r.id };
  },
  afterCommit: async ({ result, session }) => ({ status: await startBuild(result.id, session.userId), id: result.id }),
});

// ---------------------------------------------------------------- status refresh

/**
 * Polls the Devin session and applies the mapped status. Declared audit:false because most polls change
 * nothing; real status transitions are written to the audit chain in this same transaction.
 */
export const refreshToolRequest = defineAction({
  permission: "tools:request",
  input: idInput,
  audit: false,
  handler: async ({ input, session, tx: appTx }) => {
    const tx = appTx as FullTx;
    const r = await load(tx, input.id, session);
    if (!r.devinSessionId || !r.buildStartedAt) return { status: r.status, changed: false };
    const s = await getDevinSession(r.devinSessionId, { name: r.toolName, buildStartedAt: r.buildStartedAt });
    const step = nextBuildState(r, s);
    if (!step) return { status: r.status, changed: false };
    const next = await transition(tx, r, step.data);
    if (step.transition) {
      await writeAuditEvent(tx, {
        actorId: session.userId,
        action: "tool-request.status",
        entityType: ENTITY,
        entityId: r.id,
        before: snap(r),
        after: { ...snap(next), lastError: next.lastError },
        reason: `Devin session ${r.devinSessionId}`,
      });
    }
    return { status: next.status, changed: step.transition };
  },
});

// ---------------------------------------------------------------- reads

export const listToolRequests = defineAction({
  permission: "tools:request",
  input: z.object({ scope: z.enum(["mine", "approvals"]).default("mine") }),
  audit: false,
  handler: async ({ input, session, tx }) => {
    if (input.scope === "approvals" && !hasPermission(session, "tools:approve")) throw new ForbiddenError("tools:approve");
    const where = input.scope === "mine" ? { requestedById: session.userId } : { status: "SUBMITTED" as const };
    return (tx as FullTx).toolRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, toolName: true, team: true, status: true, riskTier: true, estimatedAcus: true, acusUsed: true,
        devinSessionUrl: true, prUrl: true, requestedById: true, createdAt: true,
      },
    });
  },
});

export const getToolRequest = defineAction({
  permission: "tools:request",
  input: idInput,
  audit: false,
  handler: async ({ input, session, tx }) => {
    const r = await load(tx as FullTx, input.id, session);
    const budget = teamBudgets()[r.team] ?? 0;
    const used = await teamAcusThisMonth(tx as FullTx, r.team);
    return { ...r, budget: { limit: budget, used } };
  },
});
