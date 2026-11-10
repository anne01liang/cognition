# Internal Tools Platform

## What this is

This is a prototype internal-tools platform built with Devin. It reproduces the parts of Microsoft Power Apps that matter most to a fintech: apps that run under central permissions, approval and audit, and a self-service flow where non-engineers request new apps. A request becomes a validated manifest. After approval, a Devin session builds the app as a pull request, and CI gates check that PR before a human merges it. Stack: Next.js 14 (App Router), TypeScript, Prisma/Postgres, Auth.js (mock SSO), Tailwind/shadcn, Vitest, GitHub Actions.

## What's in it

**Platform** (`src/platform/`)
- **RBAC:** `rbac.ts` is the only place roles and permissions are defined. Pages call `requirePagePermission()` before rendering.
- **`defineAction`** (`action.ts`): every server action goes through it. It checks the session and the permission, validates input with Zod, runs the handler in a transaction and writes the audit event in that same transaction.
- **Hash-chained audit** (`audit.ts`): every event stores the hash of the previous one, and a database trigger blocks UPDATE and DELETE on audit rows. Admins can check the chain at `GET /api/admin/audit/verify` or `/admin/audit`.
- **Maker-checker** (`approval.ts`): the same user can't both submit and approve an item (four-eyes).
- **PII masking:** fields marked `/// @pii` are masked in what actions return. `<MaskedField>` reveals a value only to users with `pii:reveal`, and each reveal is audited.
- **Shared UI** (`src/components/platform/`): `DataTable`, `DetailPanel`, `FormBuilder`, `StatusBadge`.

**Apps** (`src/apps/`, registered in `src/apps/registry.ts`)
- **KYC queue** (`kyc`): analysts review cases, and a different user approves them (four-eyes). Customer PII is masked.
- **Refunds** (`refunds`): support requests refunds and finance approves them. Amounts are integer cents (`@money`).
- **Visitor Log** (`visitor-log`): room visit notes. Devin generated this app from a Tool Request ([PR #5](https://github.com/anne01liang/cognition/pull/5)).

New apps follow [ADDING_AN_APP.md](./ADDING_AN_APP.md).

**Tool Requests** (`src/platform/requests/`, UI at `/requests`)
- A user with `tools:request` fills in a form. The platform turns it into a manifest, checks it against a schema, and derives a risk tier and an ACU estimate.
- Status flow: `DRAFT → SUBMITTED → APPROVED → BUILDING ↔ NEEDS_INPUT → PR_OPEN → MERGED`, or `FAILED`.
- Approval needs `tools:approve` and four-eyes, and must fit the team's monthly ACU budget.
- On approval, the platform starts a Devin session that follows ADDING_AN_APP.md and records the PR it opens.
- An app name is reserved while a request for it is in progress.

**CI gates** (`.github/workflows/`, `scripts/`)
- **`checks`** (`ci.yml`):
  - Typecheck and tests (unit, DB integration and guardrail fixtures), plus migrations, `npm audit` (high) and build.
  - **ESLint:** app code may not import `@prisma/client`, `@/platform/db` or `@/platform/audit`, use raw SQL, open its own `$transaction`, or touch the `AuditEvent` table.
  - **`check:actions`:** every `"use server"` export is a `defineAction` call, and every route and page checks a permission.
  - **`check:schema`:** fields that look like PII or money must be annotated `@pii` / `@money`.
- **`scope`** (`tool-request-scope.yml`): a PR from the Tool Request bot account (`TOOL_REQUEST_BOT_LOGIN`) may only add its own app. That means its app folder plus additions to the registry, schema, seed, migrations and its own `rbac.ts` namespace.
- **`assess`** (`risk-label.yml`): labels PRs that touch `@pii`/`@money` fields or refund, payment, payout or PII permissions. On a HIGH-risk Tool Request PR, it fails until a login in `SECURITY_REVIEWERS` approves the latest commit.
- **CODEOWNERS:** @anne01liang owns everything outside `src/apps/**`, plus each app's `permissions.ts`, `manifest.ts` and the registry.
- **The `protect-main` ruleset on `main`:**
  - `checks`, `scope` and `assess` must pass, and the branch must be up to date.
  - The latest push must be approved.
  - Force-pushes and deleting `main` are blocked.
- Setup steps for the ruleset, the `SECURITY_REVIEWERS` and `TOOL_REQUEST_BOT_LOGIN` repo variables, and a dedicated Tool Request bot identity are in [GITHUB_SETUP.md](./GITHUB_SETUP.md).

## Run locally (mock mode)

Requires Node 20 and Docker.

```bash
cp .env.example .env
# set NEXTAUTH_SECRET in .env, e.g. to the output of: openssl rand -base64 32
npm install
docker compose up -d     # Postgres 16 on localhost:5432
npm run seed             # applies migrations, seeds users and sample data
npm run dev              # http://localhost:3000/login, then pick a user (no password)
```

Mock mode is the default (`DEVIN_MODE=mock`, `MOCK_SSO_ENABLED=true` in `.env.example`), so no Devin key is needed. In mock mode, an approved Tool Request simulates a build of about 30 seconds and returns a fake PR URL:
- A tool name containing "fail" ends in `FAILED`.
- A tool name containing "question" pauses in `NEEDS_INPUT` before it finishes.

Live builds need `DEVIN_MODE=live` and `DEVIN_API_KEY`.

`npm run seed` keeps existing Tool Requests, because audit events reference them. For a clean reset, run `docker compose down -v`, then `docker compose up -d && npm run seed`. Run the same checks as CI with `npm run check`; `npm run check:audit` runs the dependency check separately.

| User | Role | Can |
| --- | --- | --- |
| alice | `kyc_analyst` | create and review KYC cases, reveal PII |
| bob | `kyc_approver` | approve KYC cases, reveal PII |
| carol | `support` | read KYC, request refunds, use Visitor Log |
| dan | `finance_approver` | approve refunds, reveal PII |
| erin | `admin` | read and verify audit, request and approve Tool Requests |
| olivia | `ops_lead` | read KYC and refunds, handle escalations, request tools |

To try a Tool Request: sign in as olivia and submit one at `/requests/new`. Then sign in as erin and approve it at `/requests`.

## Worked example: PR #5, from Tool Request to merge

1. **Request:** olivia (`ops_lead`) asked for a "Visitor log" app, a list of room visit notes with no PII or money fields. The platform rated it LOW risk. erin (`admin`) approved it. The request ID is `cmw8rx7rq0000qh4cbhu8x4ab`.
2. **Build:** the platform started a live Devin session, which opened [PR #5](https://github.com/anne01liang/cognition/pull/5) on 2026-11-09 at 04:44 UTC with no follow-up prompts. The platform recorded the PR link on the request automatically. The PR adds `src/apps/visitor-log/`, the `VisitNote` model and its migration, a registry entry, and `visitor_log:read`/`visitor_log:write` granted to `support`.
3. **Rebase:** after [PR #4](https://github.com/anne01liang/cognition/pull/4) (Tool Requests and the `scope` gate) merged, PR #5 was rebased onto `main`. The only conflict was in `prisma/schema.prisma`, where both PRs had added models. The rebased head is `39c2146`.
4. **CI on `39c2146`:** `checks` passed and `scope` reported `check-tool-request-scope: OK`. `assess` rated the PR HIGH risk, though both reasons were false alarms (see Known limitations). It then failed with `needs an approving review from one of: anne01liang`, and the merge state was `BLOCKED`.
5. **Security review:** anne01liang approved `39c2146` at 23:56 UTC. The `assess` run triggered by the review passed ([run 42724391841](https://github.com/anne01liang/cognition/actions/runs/42724391841)). The PR stayed `BLOCKED` until the earlier failed `assess` run was re-run ([run 42719911370](https://github.com/anne01liang/cognition/actions/runs/42719911370)); the merge state then became `CLEAN`.
6. **Merge:** anne01liang merged it on 2026-11-10 at 00:01 UTC as [`009df2c`](https://github.com/anne01liang/cognition/commit/009df2c18c50aa7710d7972a0214f4ae33b138c6).

## Known limitations

- **Rulesets are only enforced while the repo is public.** The repo belongs to a personal GitHub Free account, where rulesets on private repos are not enforced. [PR #4](https://github.com/anne01liang/cognition/pull/4) merged with failing `scope`/`assess` before the repo was made public.
- **Two risk-assess false alarms** (`scripts/risk-assess.mjs`) made PR #5 HIGH risk:
  - Any changed hunk that contains the text `@pii` or `@money` counts as touching an annotated field, even in prose. The trigger was a comment in `src/apps/visitor-log/actions.ts` saying the model has *no* such fields.
  - Any changed line that contains a sensitive permission counts as changing it. The `support` role line gained `visitor_log:*` and already contained `refund:read`, which didn't change.
- **`assess` has to be re-run by hand after approval.** The approval re-runs `assess` and that run passes, but the earlier failed run on the same commit keeps the PR `BLOCKED` until someone re-runs it.
- **There is one code owner.** CODEOWNERS and `SECURITY_REVIEWERS` both list only @anne01liang, and personal-account repos can't use GitHub teams. The ruleset doesn't require code-owner review (`require_code_owner_review: false`), so CODEOWNERS is advisory today.
- **The bot identity is shared.** `scope` and `assess` recognise Tool Request PRs by their author, `TOOL_REQUEST_BOT_LOGIN`, which is currently `devin-ai-integration[bot]`. That is the same account as every other Devin PR, so platform work Devin does is also checked as a Tool Request. A dedicated machine user would fix this.
- **Sign-in is mock SSO.** It lets anyone sign in as any seeded user without a password, and it is disabled when `NODE_ENV=production`. A real OIDC provider (e.g. Entra ID or Okta) is not wired up.
- **There is no feature-flag admin panel.** It is one of the client's three Power Apps apps but was not built. Only the KYC queue and refunds equivalents exist.
