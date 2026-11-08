import { z } from "zod";
import { db } from "./db";
import { paging, tableQuery } from "./table";

export const auditQuerySchema = tableQuery(["seq", "createdAt", "action", "entityType"], "seq").extend({
  actor: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Platform-only read model for /admin/audit. Caller must enforce audit:read. */
export async function queryAuditEvents(input: z.output<typeof auditQuerySchema>) {
  const actorIds = input.actor
    ? (await db.user.findMany({ where: { OR: [{ username: input.actor }, { id: input.actor }] }, select: { id: true } })).map((u) => u.id)
    : undefined;
  const where = {
    ...(actorIds ? { actorId: { in: actorIds.length ? actorIds : [input.actor!] } } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.q ? { action: { contains: input.q } } : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
            ...(input.to ? { lt: new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([db.auditEvent.findMany({ where, ...paging(input) }), db.auditEvent.count({ where })]);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, username: true } });
  const names = new Map(users.map((u) => [u.id, u.username]));
  return {
    rows: rows.map((r) => ({ ...r, id: r.id, seq: r.seq.toString(), actor: names.get(r.actorId) ?? r.actorId })),
    total,
    params: input,
  };
}
