import { z } from "zod";
import { db, type AppTx } from "./db";
import { getAppSession, type AppSession } from "./session";
import { requirePermission } from "./guard";
import { writeAuditEvent } from "./audit";
import { ActionError, type ActionErrorCode } from "./errors";
import type { Permission } from "./rbac";

/**
 * defineAction() is the ONLY way apps read or write data.
 *
 * Every call: (1) resolves the session, (2) enforces `permission`,
 * (3) validates input with Zod, (4) opens a DB transaction and hands the
 * handler a scoped `tx`, (5) if `audit` is set, requires the handler to call
 * ctx.recordAudit() and writes the hash-chained audit event(s) in the same
 * transaction. Any thrown error rolls back both the mutation and the audit.
 * (6) optional `afterCommit` runs once the transaction has committed, outside
 * it: use it for slow or external side effects (e.g. third-party API calls)
 * that must not hold a transaction open or be rolled back.
 *
 * `scripts/check-actions.ts` fails CI if a "use server" file in src/apps
 * exports anything not created by defineAction.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ActionErrorCode; message: string; fieldErrors?: Record<string, string[]> } };

export interface AuditConfig {
  /** Dotted verb, e.g. "kyc.case.approve". */
  action: string;
  /** Prisma model name, e.g. "KycCase". */
  entityType: string;
}

export interface RecordAuditInput {
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Override the configured entityType (e.g. for platform pii.reveal). */
  entityType?: string;
}

export interface ActionContext<I> {
  input: I;
  session: AppSession;
  tx: AppTx;
  recordAudit: (record: RecordAuditInput) => Promise<void>;
}

export interface ActionDefinition<S extends z.ZodType, R> {
  permission: Permission;
  input: S;
  /** Required for every mutation. `false` only for read-only queries. */
  audit: AuditConfig | false;
  handler: (ctx: ActionContext<z.output<S>>) => Promise<R>;
  /**
   * Runs after the transaction commits, outside it; its return value replaces the handler's result.
   * The commit cannot be undone here: any further writes need their own transaction and audit events.
   * If it throws, the error is logged and the committed handler result is returned.
   */
  afterCommit?: (ctx: { result: R; session: AppSession }) => Promise<R>;
}

export function defineAction<S extends z.ZodType, R>(def: ActionDefinition<S, R>) {
  return async function action(rawInput: z.input<S>): Promise<ActionResult<R>> {
    try {
      const session = requirePermission(await getAppSession(), def.permission);

      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        throw new ActionError("INVALID_INPUT", "Invalid input.", fieldErrorsOf(parsed.error));
      }

      const data = await db.$transaction(
        async (tx) => {
          let audited = 0;
          const recordAudit = async (record: RecordAuditInput) => {
            if (!def.audit) throw new Error("recordAudit() called on an action declared with audit: false");
            await writeAuditEvent(tx, {
              actorId: session.userId,
              action: def.audit.action,
              entityType: record.entityType ?? def.audit.entityType,
              entityId: record.entityId,
              before: record.before,
              after: record.after,
              reason: record.reason,
            });
            audited++;
          };

          const result = await def.handler({ input: parsed.data, session, tx: tx as AppTx, recordAudit });

          if (def.audit && audited === 0) {
            throw new Error(`Audited action "${def.audit.action}" completed without calling recordAudit()`);
          }
          return result;
        },
        { timeout: 10_000 },
      );
      if (def.afterCommit) {
        try {
          return { ok: true, data: await def.afterCommit({ result: data, session }) };
        } catch (err) {
          console.error("[defineAction] afterCommit failed; the transaction was already committed", err);
        }
      }
      return { ok: true, data };
    } catch (err) {
      return toErrorResult(err);
    }
  };
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function toErrorResult(err: unknown): ActionResult<never> {
  if (err instanceof ActionError) {
    return { ok: false, error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors } };
  }
  if (typeof err === "object" && err && "code" in err && (err as { code: unknown }).code === "P2025") {
    return { ok: false, error: { code: "NOT_FOUND", message: "Record not found." } };
  }
  console.error("[defineAction] unexpected error", err);
  return { ok: false, error: { code: "INTERNAL", message: "Something went wrong." } };
}

/** Unwrap an ActionResult in a server component; throws so error.tsx renders. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ActionError(result.error.code, result.error.message);
  return result.data;
}
