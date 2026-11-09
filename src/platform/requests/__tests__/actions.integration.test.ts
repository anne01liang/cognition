/** Tool Requests lifecycle against TEST_DATABASE_URL: RBAC, four-eyes, budget, mock Devin lifecycle, audit. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../../../../test/support/db";
import { permissionsForRoles } from "../../rbac";
import { formToManifest, manifestToYaml, toolRequestFormSchema } from "../manifest";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }));

const as = (userId: string, roles: string[]) => (session.current = { userId, username: userId, name: userId, roles, permissions: permissionsForRoles(roles) });
const olivia = () => as("olivia", ["ops_lead"]);
const erin = () => as("erin", ["admin"]);
const frank = () => as("frank", ["admin"]);
const carol = () => as("carol", ["support"]);

const form = toolRequestFormSchema.parse({
  name: "Refund Requests",
  purpose: "Support agents request refunds for customers; finance approves large ones.",
  primaryUsers: ["support"],
  readOnlyRoles: ["ops_lead"],
  entities: [{ name: "Refund", fields: [{ name: "customerEmail", type: "string", pii: true }, { name: "amount", type: "decimal", money: true }] }],
  workflowStates: ["DRAFT", "SUBMITTED", "APPROVED"],
  approvalRule: { entity: "Refund", field: "amount", threshold: 500, approverRole: "finance_approver" },
});
const manifestYaml = manifestToYaml(formToManifest(form)); // estimate = 10 + 4 + 1 + 5 + 5 = 25 ACUs
const SECRET = "apk_user_do_not_leak_42";

describe.skipIf(!hasTestDb)("tool requests (integration)", async () => {
  const { db } = await import("../../db");
  const actions = await import("../actions");

  beforeAll(async () => {
    vi.stubEnv("DEVIN_MODE", "mock");
    vi.stubEnv("DEVIN_API_KEY", SECRET);
    vi.stubEnv("TOOL_REQUEST_TEAM_BUDGETS", JSON.stringify({ operations: 40, platform: 1000 }));
    await db.toolRequest.deleteMany();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  const create = async () => {
    const res = await actions.createToolRequest({ form, manifestYaml });
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    return res.data.id;
  };
  const audits = (id: string) => db.auditEvent.findMany({ where: { entityType: "ToolRequest", entityId: id }, orderBy: { seq: "asc" } });

  it("requires tools:request to create and tools:approve to approve", async () => {
    carol();
    expect(await actions.createToolRequest({ form, manifestYaml })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    olivia();
    const id = await create();
    expect((await actions.submitToolRequest({ id })).ok).toBe(true);
    expect(await actions.approveToolRequest({ id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects a tampered manifest that downgrades the risk tier", async () => {
    olivia();
    const res = await actions.createToolRequest({ form, manifestYaml: manifestYaml.replace("riskTier: HIGH", "riskTier: LOW") });
    expect(res).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("four-eyes: the requester cannot approve their own request", async () => {
    erin();
    const id = await create();
    await actions.submitToolRequest({ id });
    const res = await actions.approveToolRequest({ id });
    expect(res.ok).toBe(false);
    expect((await db.toolRequest.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
    frank();
    expect(await actions.approveToolRequest({ id })).toMatchObject({ ok: true, data: { status: "BUILDING" } });
  });

  it("only the requester can submit, and only from DRAFT", async () => {
    olivia();
    const id = await create();
    erin();
    expect((await actions.submitToolRequest({ id })).ok).toBe(false);
    olivia();
    expect((await actions.submitToolRequest({ id })).ok).toBe(true);
    expect(await actions.submitToolRequest({ id })).toMatchObject({ ok: false });
  });

  let buildingId = "";
  it("approval starts a mock Devin session and audits the prompt, never the key", async () => {
    olivia();
    const [first] = await db.toolRequest.findMany({ where: { requestedById: "olivia", status: "SUBMITTED" }, orderBy: { createdAt: "asc" } });
    erin();
    expect(await actions.approveToolRequest({ id: first!.id, reason: "ok" })).toMatchObject({ ok: true, data: { status: "BUILDING" } });
    const r = await db.toolRequest.findUniqueOrThrow({ where: { id: first!.id } });
    expect(r).toMatchObject({ status: "BUILDING", decidedById: "erin", devinSessionId: `mock-${r.id}` });
    expect(r.devinSessionUrl).toContain(r.devinSessionId);
    buildingId = r.id;

    const events = await audits(r.id);
    expect(events.map((e) => e.action)).toEqual(["tool-request.create", "tool-request.submit", "tool-request.approve", "tool-request.build-start"]);
    const approve = events[2]!;
    expect((approve.before as { status: string }).status).toBe("SUBMITTED");
    expect((approve.after as { status: string; prompt: string }).status).toBe("APPROVED");
    expect((approve.after as { prompt: string }).prompt).toContain(`Open a PR titled 'tool-request/${r.id}: Refund Requests'`);
    expect((approve.after as { prompt: string }).prompt).toContain("riskTier: HIGH");
    expect((events[3]!.after as { status: string }).status).toBe("BUILDING");
    const all = JSON.stringify(await db.auditEvent.findMany({ where: { entityType: "ToolRequest" } }), (_k, v) => (typeof v === "bigint" ? String(v) : v));
    expect(all).not.toContain(SECRET);
  });

  it("calls the Devin API only after the approval has committed", async () => {
    frank();
    const id = await create();
    await actions.submitToolRequest({ id });
    erin();
    vi.stubEnv("DEVIN_MODE", "live");
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      // A separate connection sees the committed approval while the API call is in flight.
      seen.push((await db.toolRequest.findUniqueOrThrow({ where: { id } })).status);
      throw new TypeError("fetch failed"); // network error: a session may exist, so the estimate stays charged
    }));
    try {
      expect(await actions.approveToolRequest({ id })).toMatchObject({ ok: true, data: { status: "FAILED" } });
    } finally {
      vi.unstubAllGlobals();
      vi.stubEnv("DEVIN_MODE", "mock");
    }
    expect(seen).toEqual(["APPROVED"]);
    const r = await db.toolRequest.findUniqueOrThrow({ where: { id } });
    expect(r).toMatchObject({ status: "FAILED", acusUsed: null, devinSessionId: null });
    expect(r.lastError).toContain("fetch failed");
    expect((await audits(id)).map((e) => e.action).slice(-2)).toEqual(["tool-request.approve", "tool-request.build-start"]);
  });

  it("a started session wins over a concurrent failed start", async () => {
    frank();
    const id = await create();
    await actions.submitToolRequest({ id });
    erin();
    vi.stubEnv("DEVIN_MODE", "live");
    vi.stubGlobal("fetch", vi.fn(async () => {
      // A concurrent retry's failure (e.g. HTTP 429) commits while this call is in flight.
      await db.toolRequest.update({ where: { id }, data: { status: "FAILED", lastError: "Could not start Devin session: HTTP 429", acusUsed: 0 } });
      return new Response(JSON.stringify({ session_id: "devin-race", url: "https://app.devin.ai/sessions/race" }));
    }));
    try {
      expect(await actions.approveToolRequest({ id })).toMatchObject({ ok: true, data: { status: "BUILDING" } });
    } finally {
      vi.unstubAllGlobals();
      vi.stubEnv("DEVIN_MODE", "mock");
    }
    expect(await db.toolRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "BUILDING", devinSessionId: "devin-race", lastError: null, acusUsed: null });
    const last = (await audits(id)).at(-1)!;
    expect([(last.before as { status: string }).status, (last.after as { status: string }).status]).toEqual(["FAILED", "BUILDING"]);
  });

  it("retries the build start for a request left in APPROVED", async () => {
    frank();
    const id = await create();
    await actions.submitToolRequest({ id });
    await db.toolRequest.update({ where: { id }, data: { status: "APPROVED", decidedById: "erin", approvedAt: new Date() } });
    olivia();
    expect(await actions.retryToolRequestBuild({ id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    erin();
    const queue = await actions.listToolRequests({ scope: "approvals" });
    expect(queue.ok && queue.data.some((q) => q.id === id)).toBe(true);
    expect(await actions.retryToolRequestBuild({ id })).toMatchObject({ ok: true, data: { status: "BUILDING" } });
    expect(await db.toolRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "BUILDING", devinSessionId: `mock-${id}` });
    expect((await audits(id)).map((e) => e.action).slice(-2)).toEqual(["tool-request.build-retry", "tool-request.build-start"]);
    expect(await actions.retryToolRequestBuild({ id })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("blocks approval when the team's monthly ACU budget would be exceeded", async () => {
    // operations budget 40: 25 already approved above, another 25 would exceed it.
    olivia();
    const [second] = await db.toolRequest.findMany({ where: { requestedById: "olivia", status: "SUBMITTED" } });
    erin();
    const before = (await audits(second!.id)).length;
    const res = await actions.approveToolRequest({ id: second!.id });
    expect(res).toMatchObject({ ok: false, error: { code: "CONFLICT", message: expect.stringContaining("budget") } });
    expect((await db.toolRequest.findUniqueOrThrow({ where: { id: second!.id } })).status).toBe("SUBMITTED");
    expect((await audits(second!.id)).length).toBe(before);
  });

  it("mock lifecycle: refresh moves BUILDING -> PR_OPEN -> MERGED and audits each transition", async () => {
    olivia();
    const ago = (ms: number) => db.toolRequest.update({ where: { id: buildingId }, data: { buildStartedAt: new Date(Date.now() - ms) } });

    expect(await actions.refreshToolRequest({ id: buildingId })).toMatchObject({ ok: true, data: { status: "BUILDING", changed: false } });
    await ago(16_000);
    expect(await actions.refreshToolRequest({ id: buildingId })).toMatchObject({ ok: true, data: { status: "PR_OPEN", changed: true } });
    const pr = await db.toolRequest.findUniqueOrThrow({ where: { id: buildingId } });
    expect(pr.prUrl).toMatch(/^https:\/\/github\.com\/example-org\/internal-tools\/pull\/\d+$/);
    expect(pr.acusUsed).toBeGreaterThan(0);
    await ago(31_000);
    expect(await actions.refreshToolRequest({ id: buildingId })).toMatchObject({ ok: true, data: { status: "MERGED", changed: true } });
    expect(await actions.refreshToolRequest({ id: buildingId })).toMatchObject({ ok: true, data: { status: "MERGED", changed: false } });

    const statusEvents = (await audits(buildingId)).filter((e) => e.action === "tool-request.status");
    expect(statusEvents.map((e) => [(e.before as { status: string }).status, (e.after as { status: string }).status])).toEqual([
      ["BUILDING", "PR_OPEN"],
      ["PR_OPEN", "MERGED"],
    ]);
  });

  it("mock NEEDS_INPUT: refresh moves BUILDING -> NEEDS_INPUT -> BUILDING, audits it, and My Requests lists it with the session link", async () => {
    olivia();
    const q = await db.toolRequest.create({
      data: {
        toolName: "Question demo", team: "probe-input", riskTier: "LOW", form: {}, manifestYaml: "x", estimatedAcus: 5, requestedById: "olivia",
        approvedAt: new Date(), status: "BUILDING", devinSessionId: "mock-q1", devinSessionUrl: "https://app.devin.ai/sessions/mock-q1", buildStartedAt: new Date(Date.now() - 6_000),
      },
    });
    expect(await actions.refreshToolRequest({ id: q.id })).toMatchObject({ ok: true, data: { status: "NEEDS_INPUT", changed: true } });
    const mine = await actions.listToolRequests({ scope: "mine" });
    expect(mine.ok && mine.data.find((r) => r.id === q.id)).toMatchObject({ status: "NEEDS_INPUT", devinSessionUrl: "https://app.devin.ai/sessions/mock-q1" });
    await db.toolRequest.update({ where: { id: q.id }, data: { buildStartedAt: new Date(Date.now() - 21_000) } });
    expect(await actions.refreshToolRequest({ id: q.id })).toMatchObject({ ok: true, data: { status: "BUILDING", changed: true } });
    const statusEvents = (await audits(q.id)).filter((e) => e.action === "tool-request.status");
    expect(statusEvents.map((e) => [(e.before as { status: string }).status, (e.after as { status: string }).status])).toEqual([
      ["BUILDING", "NEEDS_INPUT"],
      ["NEEDS_INPUT", "BUILDING"],
    ]);
  });

  it("two viewers of one request: when one poll saves the change first, both re-render to the server's status", async () => {
    olivia();
    const { pollShownStatuses } = await import("../poll");
    const q = await db.toolRequest.create({
      data: {
        toolName: "Question two viewers", team: "probe-input", riskTier: "LOW", form: {}, manifestYaml: "x", estimatedAcus: 5, requestedById: "olivia",
        approvedAt: new Date(), status: "NEEDS_INPUT", devinSessionId: "mock-q2", devinSessionUrl: "https://app.devin.ai/sessions/mock-q2", buildStartedAt: new Date(Date.now() - 21_000),
      },
    });
    const viewerA = { [q.id]: "NEEDS_INPUT" };
    const viewerB = { [q.id]: "NEEDS_INPUT" };
    expect(await pollShownStatuses(viewerA, actions.refreshToolRequest)).toBe(true); // A's poll saves NEEDS_INPUT -> BUILDING
    expect((await db.toolRequest.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("BUILDING");
    expect(await actions.refreshToolRequest({ id: q.id })).toMatchObject({ ok: true, data: { status: "BUILDING", changed: false } });
    expect(await pollShownStatuses(viewerB, actions.refreshToolRequest)).toBe(true); // B's poll changed nothing, but B still re-renders
    // After re-rendering, both show BUILDING and stop refreshing the page.
    expect(await pollShownStatuses({ [q.id]: "BUILDING" }, actions.refreshToolRequest)).toBe(false);
  });

  it("budget: FAILED requests are free only if the session definitely never started", async () => {
    const { teamAcusThisMonth } = await import("../lifecycle");
    const base = { toolName: "Budget probe", riskTier: "LOW" as const, form: {}, manifestYaml: "x", requestedById: "probe", approvedAt: new Date(), status: "FAILED" as const };
    let usedBefore = await db.$transaction((tx) => teamAcusThisMonth(tx, "probe-team"));
    await db.toolRequest.create({ data: { ...base, team: "probe-team", estimatedAcus: 7, acusUsed: 0 } });
    expect(await db.$transaction((tx) => teamAcusThisMonth(tx, "probe-team"))).toBe(usedBefore);
    await db.toolRequest.create({ data: { ...base, team: "probe-team", estimatedAcus: 5 } });
    expect(await db.$transaction((tx) => teamAcusThisMonth(tx, "probe-team"))).toBe(usedBefore + 5);
    usedBefore += 5;
    await db.toolRequest.create({ data: { ...base, team: "probe-team", estimatedAcus: 9, devinSessionId: "mock-x", acusUsed: 12 } });
    expect(await db.$transaction((tx) => teamAcusThisMonth(tx, "probe-team"))).toBe(usedBefore + 12);
  });

  it("hides other people's requests from requesters", async () => {
    as("someone", ["ops_lead"]);
    expect(await actions.getToolRequest({ id: buildingId })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await actions.refreshToolRequest({ id: buildingId })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await actions.listToolRequests({ scope: "approvals" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
