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

Tool Requests run in mock mode by default (`DEVIN_MODE=mock`, no key needed): an approved request simulates a ~30s Devin build with a fake PR URL. Set `DEVIN_API_KEY` (and `DEVIN_MODE=live`) to start real sessions via the v1 API.

To build a new app follow **[ADDING_AN_APP.md](./ADDING_AN_APP.md)**.
