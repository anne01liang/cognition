# Adding an app

This guide is followed literally by humans **and AI agents**. Do every step, in
order, using the exact file names. Replace `<app>` with your app id: lowercase,
`a-z` and `-` only, e.g. `chargebacks`. Replace `<Model>` with your Prisma model
name in PascalCase, e.g. `Chargeback`. Use `src/apps/kyc/` as the reference
implementation — copy its structure.

> **Golden rules (CI fails if you break them)**
> 1. Apps never import `@prisma/client`, `@/platform/db` or `@/platform/audit`.
>    Your only DB handle is the `tx` passed to a `defineAction()` handler.
> 2. Every export of `src/apps/<app>/actions.ts` is `export const x = defineAction({ permission, input, audit, handler })`.
> 3. Every mutation has `audit: { action, entityType }` and calls `ctx.recordAudit(...)`.
>    Only read-only queries use `audit: false`.
> 4. Every page calls `await requirePagePermission(...)` as its first line.
> 5. Personal data fields carry `/// @pii`; money fields carry `/// @money` and are `Int` cents.
> 6. Never return raw `@pii` values from an action. Return `maskValue(x)`; show with `<MaskedField>`.
> 7. Never invent permission strings in app code. Declare them in `src/platform/rbac.ts`.

## Step 1 — Permissions (`src/platform/rbac.ts`)

1. Add your permissions to `PERMISSIONS` under a comment `// ---- app: <app> ----`.
   Format: `<namespace>:<verb>`, one namespace per app (e.g. `chargeback:read`,
   `chargeback:create`, `chargeback:approve`). Always include a `:read`.
2. Grant them to roles in `ROLES`. Do **not** give business permissions to `admin`.
   If a new role is needed, add it to `ROLES` and to `prisma/seed.ts` `USERS`.
3. Maker-checker apps need separate permissions for submitting and approving,
   and no single role should hold both.

> Changing `rbac.ts` requires @security-team review (CODEOWNERS). Permissions
> matching `refund|payment|payout|pii` auto-label the PR `needs-security-review`.

## Step 2 — Schema (`prisma/schema.prisma`)

1. Append a section at the end of the file:
   ```prisma
   // ===== app: <app> =====
   model <Model> {
     id             String         @id @default(cuid())
     /// @pii
     customerName   String
     /// @money Minor units (cents).
     amountCents    Int
     status         ApprovalStatus @default(DRAFT)   // only if maker-checker
     createdById    String
     submittedById  String?                          // only if maker-checker
     decidedById    String?                          // only if maker-checker
     decisionReason String?                          // only if maker-checker
     createdAt      DateTime       @default(now())
     updatedAt      DateTime       @updatedAt
   }
   ```
2. Annotate **every** personal-data field with `/// @pii` and every money field
   with `/// @money` on the line directly above it. Money is `Int`/`BigInt` cents
   or `Decimal`, never `Float`. `npm run check:schema` enforces this by field name.
3. Do not edit the `platform` section or other apps' sections.
4. Create the migration: `npx prisma migrate dev --name <app>_init`. Commit the
   generated `prisma/migrations/<timestamp>_<app>_init/` folder.

## Step 3 — Create the app folder

Create exactly these files (copy from `src/apps/kyc/` and rename):

```
src/apps/<app>/
  permissions.ts        # typed references to rbac.ts strings
  schemas.ts            # Zod schemas: inputs for every action + forms
  actions.ts            # "use server"; only defineAction exports
  manifest.ts           # nav entry + PII resolvers
  pages/<Name>Page.tsx  # one file per route, default export, server components
  components/*.tsx      # client components ("use client") if needed
  __tests__/<app>.test.ts
```

### 3a. `permissions.ts`
```ts
import type { Permission } from "@/platform/rbac";

export const CHARGEBACK = {
  read: "chargeback:read",
  create: "chargeback:create",
  approve: "chargeback:approve",
} as const satisfies Record<string, Permission>;
```

### 3b. `schemas.ts`
- One Zod schema per action input. Bound every string (`.max()`), number
  (`.int().positive().max()`), and use `z.enum` for statuses.
- `.describe("Label")` sets the FormBuilder label.
- List inputs: `tableQuery(["createdAt", ...sortableColumns]).extend({ status: z.enum(STATUSES).optional() })`.

### 3c. `actions.ts`
```ts
"use server";

import { defineAction } from "@/platform/action";
import { decideApproval, submitForApproval } from "@/platform/approval";
import { NotFoundError, ConflictError } from "@/platform/errors";
import { maskValue } from "@/platform/mask";
import { paging } from "@/platform/table";
import { CHARGEBACK } from "./permissions";
import { createSchema, listSchema } from "./schemas";

export const listChargebacks = defineAction({
  permission: CHARGEBACK.read,
  input: listSchema,
  audit: false, // read-only
  handler: async ({ input, tx }) => {
    const where = input.status ? { status: input.status } : {};
    const [rows, total] = await Promise.all([
      tx.chargeback.findMany({ where, ...paging(input) }),
      tx.chargeback.count({ where }),
    ]);
    return { rows: rows.map((r) => ({ ...r, customerName: maskValue(r.customerName) })), total, params: input };
  },
});

export const createChargeback = defineAction({
  permission: CHARGEBACK.create,
  input: createSchema,
  audit: { action: "chargeback.create", entityType: "Chargeback" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const row = await tx.chargeback.create({ data: { ...input, createdById: session.userId } });
    await recordAudit({ entityId: row.id, before: null, after: { amountCents: row.amountCents, status: row.status } });
    return { id: row.id };
  },
});
```
Rules:
- No other exports (no helper functions, no types, no re-exports). Put helpers
  in a separate non-`"use server"` file (e.g. `src/apps/<app>/money.ts`).
- Audit `action` is `<app>.<entity>.<verb>`; `entityType` is the Prisma model name.
- `before`/`after` must not contain raw PII: use `maskValue()` for `@pii` fields.
- Approvals: load the row, call `submitForApproval(row, session.userId)` or
  `decideApproval(row, decision, session.userId)` (enforces approver ≠ submitter),
  then `tx.<model>.updateMany({ where: { id, status: row.status }, data })` and
  throw `ConflictError` if `count !== 1`. Pass the decision `reason` to `recordAudit`.
- Throw `NotFoundError` / `ConflictError` / `ForbiddenError` from `@/platform/errors`
  for user-facing errors. Any other error becomes a generic "Something went wrong".

### 3d. Pages (`pages/<Name>Page.tsx`)
```tsx
import { requirePagePermission } from "@/platform/session";
import { unwrap } from "@/platform/action";
import { firstValues } from "@/platform/table";
import { DataTable } from "@/components/platform/DataTable";
import { listChargebacks } from "../actions";
import { CHARGEBACK } from "../permissions";

export default async function ChargebackListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requirePagePermission(CHARGEBACK.read); // FIRST LINE, always
  const page = unwrap(await listChargebacks(firstValues(searchParams)));
  return <DataTable basePath="/apps/<app>" params={page.params} rows={page.rows} total={page.total} columns={[/* ... */]} />;
}
```
- Building blocks: `DataTable`, `DetailPanel`, `StatusBadge`, `MaskedField`
  (server components) and `FormBuilder` (client) in `src/components/platform/`.
- Hide buttons with `hasPermission(session, ...)` from `@/platform/guard` — UI only;
  the action re-checks.
- PII: `<MaskedField value={row.field} entityType="<Model>" entityId={row.id} field="field" />`.
  Never pass raw PII props to a `"use client"` component.
- Forms: a `"use client"` component in `components/` rendering
  `<FormBuilder schema={createSchema} action={createChargeback} onSuccess={...} />`.

### 3e. Route shims (`src/app/(platform)/apps/<app>/...`)
For each page create a 3-line shim — no logic here:
```tsx
// src/app/(platform)/apps/<app>/page.tsx
export { default } from "@/apps/<app>/pages/ChargebackListPage";
export const dynamic = "force-dynamic";
```
Use `new/page.tsx`, `[id]/page.tsx` etc. for sub-routes. `src/app/(platform)/apps/<app>/page.tsx` must exist.

### 3f. `manifest.ts`
```ts
import { defineApp } from "@/platform/app-manifest";
import { CHARGEBACK } from "./permissions";

export const chargebacksApp = defineApp({
  id: "<app>",                    // must equal the folder name
  name: "Chargebacks",
  description: "One sentence.",
  basePath: "/apps/<app>",        // must be exactly this
  permission: CHARGEBACK.read,    // who sees the app in the nav
  nav: [{ label: "Chargebacks", href: "/apps/<app>", permission: CHARGEBACK.read }],
  pii: {
    Chargeback: {
      customerName: {
        readPermission: CHARGEBACK.read,
        load: async (tx, id) => (await tx.chargeback.findUnique({ where: { id }, select: { customerName: true } }))?.customerName ?? null,
      },
    },
  },
});
```
Every `@pii` field shown with `<MaskedField>` must have a `pii` resolver.

## Step 4 — Register (`src/apps/registry.ts`)
Import the manifest and add it to `APPS`. Nav filtering by permission is automatic.

## Step 5 — Tests (`src/apps/<app>/__tests__/<app>.test.ts`)
Minimum (see `src/apps/kyc/__tests__/kyc.test.ts`):
1. Schema validation rejects bad input.
2. A user **without** the permission gets `{ ok: false, error: { code: "FORBIDDEN" } }`.
3. For maker-checker: the submitter cannot approve their own request.
4. Every mutation writes the expected audit actions (query `db.auditEvent` in the test).
5. Actions never return raw `@pii` values.

Integration tests mock the session with
`vi.mock("@/platform/session", () => ({ getAppSession: async () => session.current }))`
and wrap DB tests in `describe.skipIf(!hasTestDb)`.

## Step 6 — Seed (optional)
Add sample rows in `prisma/seed.ts` inside a `prisma.$transaction` that also calls
`writeAuditEvent(tx, ...)` for each row.

## Step 7 — Verify locally
```
npm run typecheck && npm run lint && npm run check:actions && npm run check:schema && npm test
```

---

## Checklist (copy into the PR description)

- [ ] Permissions added to `src/platform/rbac.ts` (`PERMISSIONS` + `ROLES`), one namespace, includes `:read`, none granted to `admin`
- [ ] `src/apps/<app>/permissions.ts` only references strings from `rbac.ts`
- [ ] Schema section `// ===== app: <app> =====`; all PII fields `/// @pii`; all money fields `/// @money` + `Int` cents
- [ ] Migration generated and committed
- [ ] `actions.ts` starts with `"use server"` and every export is `defineAction({ permission, input, audit, handler })`
- [ ] Every mutation has `audit: { action, entityType }` and calls `recordAudit` with masked before/after
- [ ] Approval flows use `submitForApproval` / `decideApproval` + `updateMany` status check
- [ ] No imports of `@prisma/client`, `@/platform/db`, `@/platform/audit`; no raw SQL; no `$transaction`
- [ ] Every page calls `requirePagePermission` first; route shims contain no logic
- [ ] Raw PII never returned by actions; displayed only via `<MaskedField>` with a manifest `pii` resolver
- [ ] Manifest `id` = folder name, `basePath` = `/apps/<app>`, registered in `src/apps/registry.ts`
- [ ] Tests: validation, FORBIDDEN, four-eyes (if approvals), audit events, no raw PII
- [ ] `npm run check` passes locally
