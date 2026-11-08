"use server";
import { z } from "zod";
import { defineAction } from "@/platform/action";

export const ping = defineAction({
  permission: "kyc:read",
  input: z.object({}),
  audit: false,
  handler: async () => "pong",
});
