import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script without types
import { needsSecurityReview, parseReviewers, securityReviewStatus } from "../check-security-review.mjs";

const HEAD = "bbb";
const review = (login: string, state: string, commit_id = HEAD) => ({ user: { login }, state, commit_id });
const reviewers = parseReviewers(" Sam-Sec, tara ");

describe("security review gate for HIGH-risk tool-request PRs", () => {
  it("fails without any review, and when SECURITY_REVIEWERS is empty", () => {
    expect(securityReviewStatus({ reviews: [], headSha: HEAD, reviewers }).ok).toBe(false);
    expect(securityReviewStatus({ reviews: [review("sam-sec", "APPROVED")], headSha: HEAD, reviewers: [] }).ok).toBe(false);
  });

  it("passes once a listed reviewer approves the head commit (logins are case-insensitive)", () => {
    const s = securityReviewStatus({ reviews: [review("Sam-Sec", "APPROVED")], headSha: HEAD, reviewers });
    expect(s).toMatchObject({ ok: true, approvers: ["sam-sec"] });
  });

  it("ignores approvals from people who are not security reviewers", () => {
    expect(securityReviewStatus({ reviews: [review("anne01liang", "APPROVED")], headSha: HEAD, reviewers }).ok).toBe(false);
  });

  it("an approval of an earlier commit doesn't count", () => {
    const s = securityReviewStatus({ reviews: [review("tara", "APPROVED", "aaa")], headSha: HEAD, reviewers });
    expect(s.ok).toBe(false);
    expect(s.message).toContain("latest commit needs a new approval");
  });

  it("a dismissed approval or an outstanding change request blocks; a later comment doesn't undo an approval", () => {
    expect(securityReviewStatus({ reviews: [review("tara", "APPROVED"), review("tara", "DISMISSED")], headSha: HEAD, reviewers }).ok).toBe(false);
    expect(
      securityReviewStatus({ reviews: [review("tara", "APPROVED"), review("sam-sec", "CHANGES_REQUESTED")], headSha: HEAD, reviewers }).ok,
    ).toBe(false);
    expect(securityReviewStatus({ reviews: [review("tara", "APPROVED"), review("tara", "COMMENTED")], headSha: HEAD, reviewers }).ok).toBe(true);
  });

  it("applies to risky PRs by the Tool Request bot, whatever the case of the configured login", () => {
    expect(needsSecurityReview({ author: "devin-ai-integration[bot]", risky: "true" })).toBe(true);
    expect(needsSecurityReview({ author: "acme-tool-builder", risky: "true", botLogin: "Acme-Tool-Builder" })).toBe(true);
    expect(needsSecurityReview({ author: "devin-ai-integration[bot]", risky: "false" })).toBe(false);
    expect(needsSecurityReview({ author: "anne01liang", risky: "true" })).toBe(false);
  });

  it("CLI: skips human PRs and LOW-risk bot PRs without calling GitHub", () => {
    const run = (env: Record<string, string>) =>
      execFileSync(process.execPath, [path.resolve(__dirname, "../check-security-review.mjs")], {
        env: { ...process.env, TOOL_REQUEST_BOT_LOGIN: "", ...env },
        encoding: "utf8",
      });
    expect(run({ PR_AUTHOR: "anne01liang", RISKY: "true" })).toContain("skipped");
    expect(run({ PR_AUTHOR: "devin-ai-integration[bot]", RISKY: "false" })).toContain("skipped");
  });
});
