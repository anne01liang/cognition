#!/usr/bin/env node
/**
 * HIGH-risk tool-request PRs (opened by the Tool Request bot and flagged by risk-assess) fail until a security
 * reviewer has approved the PR's current head commit. Dependency-free so the risk-label workflow runs it without `npm ci`.
 *
 * Reviewers come from the repo variable SECURITY_REVIEWERS (comma-separated GitHub logins): GITHUB_TOKEN cannot read
 * org team membership, so the list mirrors @security-team. Unset or empty list = nobody can approve (fails closed).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_BOT_LOGIN = "devin-ai-integration[bot]";

/**
 * GitHub logins are case-insensitive, so a differently cased TOOL_REQUEST_BOT_LOGIN still matches.
 * @param {{ author: string; risky: string | undefined; botLogin?: string }} pr
 */
export function needsSecurityReview({ author, risky, botLogin = DEFAULT_BOT_LOGIN }) {
  return author.toLowerCase() === botLogin.toLowerCase() && risky === "true";
}

/** @param {string | undefined} v */
export function parseReviewers(v) {
  return (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {{ reviews: { user: { login: string } | null; state: string; commit_id: string }[]; headSha: string; reviewers: string[] }} input
 *   `reviews` in GitHub's order (oldest first).
 * @returns {{ ok: boolean; approvers: string[]; message: string }}
 */
export function securityReviewStatus({ reviews, headSha, reviewers }) {
  if (reviewers.length === 0) {
    return { ok: false, approvers: [], message: "SECURITY_REVIEWERS is not set, so no one can approve this HIGH-risk PR" };
  }
  /** @type {Map<string, { state: string; commit_id: string }>} */
  const latest = new Map();
  for (const r of reviews) {
    const login = r.user?.login?.toLowerCase();
    // A comment doesn't change an earlier approval or change request.
    if (!login || !reviewers.includes(login) || r.state === "COMMENTED" || r.state === "PENDING") continue;
    latest.set(login, r);
  }
  const blocking = [...latest].filter(([, r]) => r.state === "CHANGES_REQUESTED").map(([l]) => l);
  if (blocking.length) return { ok: false, approvers: [], message: `changes requested by security reviewer(s): ${blocking.join(", ")}` };
  const approvers = [...latest].filter(([, r]) => r.state === "APPROVED" && r.commit_id === headSha).map(([l]) => l);
  if (approvers.length) return { ok: true, approvers, message: `approved by security reviewer(s): ${approvers.join(", ")}` };
  const stale = [...latest].some(([, r]) => r.state === "APPROVED");
  return {
    ok: false,
    approvers: [],
    message: stale
      ? "a security reviewer approved an earlier commit; the latest commit needs a new approval"
      : `needs an approving review from one of: ${reviewers.join(", ")}`,
  };
}

async function fetchReviews(repo, pr, token) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub reviews API returned ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const botLogin = env.TOOL_REQUEST_BOT_LOGIN || DEFAULT_BOT_LOGIN;
  if (!env.PR_AUTHOR) {
    console.error("check-security-review: PR_AUTHOR is not set; refusing to skip the check");
    process.exit(1);
  }
  if (!needsSecurityReview({ author: env.PR_AUTHOR, risky: env.RISKY, botLogin })) {
    console.log(`check-security-review: not a HIGH-risk tool-request PR (author ${env.PR_AUTHOR}, risky=${env.RISKY}); skipped`);
    process.exit(0);
  }
  const reviews = await fetchReviews(env.GITHUB_REPOSITORY, env.PR_NUMBER, env.GITHUB_TOKEN);
  const status = securityReviewStatus({ reviews, headSha: env.HEAD_SHA, reviewers: parseReviewers(env.SECURITY_REVIEWERS) });
  console.log(`check-security-review: HIGH-risk tool-request PR; ${status.message}`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `Security review: ${status.message}\n`);
  process.exit(status.ok ? 0 : 1);
}
