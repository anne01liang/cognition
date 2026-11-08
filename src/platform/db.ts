import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * PLATFORM-ONLY database client. Apps (src/apps/**) must never import this
 * file (ESLint enforces it); they receive a scoped `tx` from defineAction().
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type FullTx = Prisma.TransactionClient;

/**
 * The transaction handle given to app handlers. Raw SQL escape hatches and
 * the audit table are removed from the type: apps write audit events only
 * via ctx.recordAudit(), and must not use unparameterised SQL.
 */
export type AppTx = Omit<
  Prisma.TransactionClient,
  "$executeRawUnsafe" | "$queryRawUnsafe" | "$executeRaw" | "$queryRaw" | "auditEvent" | "user"
>;
