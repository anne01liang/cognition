"use server";
// FIXTURE (deliberately violates check-actions).
import { z } from "zod";
import { defineAction } from "@/platform/action";

export async function deleteCase(id: string) {
  return id;
}

export const sneaky = async () => "no guard";

export const missingAudit = defineAction({
  permission: "kyc:read",
  input: z.object({}),
  handler: async () => null,
});

export const fine = defineAction({
  permission: "kyc:read",
  input: z.object({}),
  audit: false,
  handler: async () => null,
});
