import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FullTx } from "./db";

/**
 * Tamper-evident audit log.
 *
 *   hash = sha256(prevHash + canonicalJSON(all row fields except `hash`))
 *
 * Writers take a transaction-scoped advisory lock before reading the chain
 * head, so concurrent transactions append strictly one after another and
 * `seq` is gap-free. UPDATE/DELETE/TRUNCATE are rejected by a DB trigger.
 *
 * Only defineAction() (via ctx.recordAudit) and platform code call
 * writeAuditEvent. Apps never touch the AuditEvent table directly.
 */

export const AUDIT_CHAIN_LOCK_KEY = BigInt(746_174_001);
export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface AuditHashFields {
  id: string;
  seq: bigint;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: Date;
  prevHash: string;
}

/** Deterministic JSON: object keys sorted recursively, Dates as ISO, bigint as string. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

/** JSON round-trip so the hashed value equals what Postgres jsonb returns. */
function toJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(canonicalJSON(value));
}

export function computeAuditHash(f: AuditHashFields): string {
  const payload = canonicalJSON({
    id: f.id,
    seq: f.seq,
    actorId: f.actorId,
    action: f.action,
    entityType: f.entityType,
    entityId: f.entityId,
    before: f.before ?? null,
    after: f.after ?? null,
    reason: f.reason ?? null,
    createdAt: f.createdAt,
    prevHash: f.prevHash,
  });
  return createHash("sha256").update(f.prevHash + payload).digest("hex");
}

/** Must be called inside a transaction. */
export async function writeAuditEvent(tx: FullTx, input: AuditInput) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})::text AS locked`;
  const head = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });

  const fields: AuditHashFields = {
    id: randomUUID(),
    seq: (head?.seq ?? BigInt(0)) + BigInt(1),
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: toJsonValue(input.before),
    after: toJsonValue(input.after),
    reason: input.reason ?? null,
    createdAt: new Date(),
    prevHash: head?.hash ?? GENESIS_HASH,
  };
  const hash = computeAuditHash(fields);

  return tx.auditEvent.create({
    data: {
      ...fields,
      before: fields.before === null ? Prisma.DbNull : (fields.before as Prisma.InputJsonValue),
      after: fields.after === null ? Prisma.DbNull : (fields.after as Prisma.InputJsonValue),
      hash,
    },
  });
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBrokenSeq: string | null;
}

/** Recomputes the whole chain in seq order. Read-only. */
export async function verifyAuditChain(client: Pick<PrismaClient, "auditEvent">, batchSize = 500): Promise<VerifyResult> {
  let prevHash = GENESIS_HASH;
  let expectedSeq = BigInt(1);
  let checked = 0;
  let cursor = BigInt(0);

  for (;;) {
    const rows = await client.auditEvent.findMany({
      where: { seq: { gt: cursor } },
      orderBy: { seq: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const recomputed = computeAuditHash({ ...row, reason: row.reason ?? null });
      if (row.seq !== expectedSeq || row.prevHash !== prevHash || row.hash !== recomputed) {
        return { ok: false, checked, firstBrokenSeq: row.seq.toString() };
      }
      checked++;
      prevHash = row.hash;
      expectedSeq = row.seq + BigInt(1);
      cursor = row.seq;
    }
  }
  return { ok: true, checked, firstBrokenSeq: null };
}
