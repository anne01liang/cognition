"use server";

import { z } from "zod";
import { defineAction } from "@/platform/action";
import { requirePermission } from "@/platform/guard";
import { NotFoundError } from "@/platform/errors";
import { findPiiResolver } from "@/apps/registry";

/**
 * The only way to obtain a raw @pii value in the UI. Requires pii:reveal
 * plus the owning app's read permission, and writes a "pii.reveal" audit
 * event (the value itself is never written to the audit log).
 */
export const revealPii = defineAction({
  permission: "pii:reveal",
  input: z.object({
    entityType: z.string().min(1).max(64),
    entityId: z.string().min(1).max(64),
    field: z.string().min(1).max(64),
  }),
  audit: { action: "pii.reveal", entityType: "PII" },
  handler: async ({ input, session, tx, recordAudit }) => {
    const resolver = findPiiResolver(input.entityType, input.field);
    if (!resolver) throw new NotFoundError("PII field");
    requirePermission(session, resolver.readPermission);
    const value = await resolver.load(tx, input.entityId);
    if (value === null) throw new NotFoundError();
    await recordAudit({ entityType: input.entityType, entityId: input.entityId, after: { field: input.field } });
    return { value };
  },
});
