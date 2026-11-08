// FIXTURE (deliberately violates the rules). Linted as if it lived at src/apps/demo/actions.ts.
import { PrismaClient } from "@prisma/client";
import { db } from "@/platform/db";

export async function leak() {
  const prisma = new PrismaClient();
  await db.$executeRawUnsafe("DELETE FROM \"KycCase\"");
  return prisma.kycCase.findMany();
}
