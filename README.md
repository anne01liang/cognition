# Internal Tools Platform

Foundation for internal apps replacing Power Apps. Next.js 14 (App Router) ·
Prisma/Postgres · Auth.js (mock SSO) · Tailwind/shadcn · Vitest.

## Run locally

```bash
cp .env.example .env            # then set NEXTAUTH_SECRET (openssl rand -base64 32)
npm install
docker compose up -d            # Postgres on :5432
npm run seed                    # applies migrations + seeds users and sample data
npm run dev                     # http://localhost:3000 -> pick a user on /login
```

Seed users: alice (kyc_analyst), bob (kyc_approver), carol (support),
dan (finance_approver), erin (admin), olivia (ops_lead).

## Checks (same as CI)

```bash
npm run typecheck
npm run lint            # incl. "apps may not import @prisma/client / platform/db"
npm run check:actions   # every "use server" export is defineAction; routes/pages guarded
npm run check:schema    # @pii / @money annotations
npm test                # unit + DB integration (uses TEST_DATABASE_URL, schema "test")
npm run check:audit     # npm audit --audit-level=high with expiring allowlist
```

## Architecture

| Concern | Where |
| --- | --- |
| Roles & permissions (single source) | `src/platform/rbac.ts` |
| Guard | `requirePermission()` in `src/platform/guard.ts`; pages use `requirePagePermission()` |
| All app reads/writes | `defineAction()` in `src/platform/action.ts` |
| Hash-chained audit log | `src/platform/audit.ts`, trigger in `prisma/migrations/*_audit_append_only` |
| Audit verify API | `GET /api/admin/audit/verify` (admin) · UI at `/admin/audit` |
| Maker-checker | `src/platform/approval.ts` |
| PII reveal | `<MaskedField>` + `revealPii` (`src/platform/pii/actions.ts`) |
| UI blocks | `src/components/platform/` (DataTable, DetailPanel, FormBuilder, StatusBadge) |
| Apps | `src/apps/<app>/`, registered in `src/apps/registry.ts` |
| Tool Requests (request → manifest → approval → Devin build) | `src/platform/requests/`, UI at `/requests` (`tools:request`, `tools:approve`) |
| CI guardrails | `.github/workflows/ci.yml`, `.github/workflows/risk-label.yml`, `.github/CODEOWNERS`, `scripts/` |

Tool Requests run in mock mode by default (`DEVIN_MODE=mock`, no key needed): an approved request simulates a ~30s Devin build with a fake PR URL. Tool names containing "fail" end FAILED; names containing "question" pause in NEEDS_INPUT (shown on My Requests with a link to the session) from 5s to 20s, then finish. Set `DEVIN_API_KEY` (and `DEVIN_MODE=live`) to start real sessions via the v1 API.

## Branch protection (a human must enable)

The CI guardrails only block merges if GitHub enforces them. On `main` (Settings → Branches, or a ruleset):

1. **Require a pull request before merging**, with at least 1 approval.
2. **Require review from Code Owners** (makes `.github/CODEOWNERS` bite: @security-team on everything outside `src/apps/**`). Teams only exist in GitHub organizations: move the repo into an org and create `@security-team` with write access, or replace it in CODEOWNERS with named users.
3. **Dismiss stale approvals when new commits are pushed** and **require approval of the most recent push**, so a reviewed PR can't change afterwards unreviewed.
4. **Require status checks to pass**, with these required: `checks` (CI), `scope` (tool-request-scope: Tool Request bot PRs may only add one new app), `assess` (risk label + security approval for HIGH-risk tool-request PRs). Also **require branches to be up to date**.
5. **Do not allow bypassing the above settings** (applies to admins too).
6. **Block force pushes and branch deletion.**

Repo variables (Settings → Secrets and variables → Actions → Variables):

- `SECURITY_REVIEWERS`: comma-separated GitHub logins of @security-team. App code under `src/apps/**` has no code owner, so for a HIGH-risk tool-request PR (it touches `@pii`/`@money` fields or sensitive permissions) `assess` fails until one of them approves the PR's latest commit; it re-runs on every review. A list, because `GITHUB_TOKEN` can't read org team membership; a GitHub App or token with org *Members: read* could replace it with a team lookup. Unset = no one can approve (fails closed).
- `TOOL_REQUEST_BOT_LOGIN`: the GitHub login that Tool Request PRs are opened under (default `devin-ai-integration[bot]`).

A PR that edits a workflow runs its own copy of that workflow, which is why `.github/` changes need code-owner review.

### Production requirement: a dedicated GitHub identity for Tool Request builds

`scope` and the security-review gate key on the PR author. With the default, every PR any Devin session opens (including platform work engineers ask Devin for) is treated as a tool request and fails `scope`. Give Tool Request builds their own login:

1. Create a GitHub machine user (e.g. `acme-tool-builder`) with write access to this repo only.
2. Create a Devin user for it and link its GitHub account (Devin → Settings → Connections → GitHub).
3. Start Tool Request sessions as that Devin user: a v1 personal API key of that user as `DEVIN_API_KEY`, or a v3 service user with `create_as_user_id` (needs `ImpersonateOrgSessions`).
4. In Devin → Settings → Devin → Pull requests, set **Open PRs as: User only**, so a session that can't open the PR as that user fails instead of falling back to `devin-ai-integration[bot]` (which would skip both checks).
5. Set the repo variable `TOOL_REQUEST_BOT_LOGIN=acme-tool-builder`.

A separate Devin GitHub App installation or Devin org doesn't help: every installation opens PRs as `devin-ai-integration[bot]`.

To build a new app follow **[ADDING_AN_APP.md](./ADDING_AN_APP.md)**.
