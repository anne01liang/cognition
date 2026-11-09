/* eslint-disable no-console */
/**
 * Idempotent dev seed. Users are platform identity data (upserted directly).
 * Business entities are created inside a transaction WITH audit events, the
 * same way defineAction does it, so the audit chain is valid from day one.
 */
import { PrismaClient } from "@prisma/client";
import { writeAuditEvent } from "../src/platform/audit";
import { kycReviewSeedCases } from "./seed-kyc-review";

const prisma = new PrismaClient();

const USERS = [
  { username: "alice", name: "Alice Analyst", roles: ["kyc_analyst"] },
  { username: "bob", name: "Bob Approver", roles: ["kyc_approver"] },
  { username: "carol", name: "Carol Support", roles: ["support"] },
  { username: "dan", name: "Dan Finance", roles: ["finance_approver"] },
  { username: "erin", name: "Erin Admin", roles: ["admin"] },
  { username: "olivia", name: "Olivia Ops", roles: ["ops_lead"] },
];

async function main() {
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, roles: u.roles },
      create: { ...u, email: `${u.username}@example.internal` },
    });
    ids[u.username] = user.id;
  }

  if ((await prisma.kycCase.count()) === 0) {
    await prisma.$transaction(async (tx) => {
      const samples = [
        { customerName: "Jane Doe", documentNumber: "P12345678", country: "US", riskLevel: "LOW" as const },
        { customerName: "John Smith", documentNumber: "X98765432", country: "GB", riskLevel: "HIGH" as const },
        { customerName: "Maria Garcia", documentNumber: "ES-4455667", country: "ES", riskLevel: "MEDIUM" as const },
      ];
      for (const [i, s] of samples.entries()) {
        const submitted = i > 0;
        const c = await tx.kycCase.create({
          data: { ...s, createdById: ids.alice!, status: submitted ? "PENDING" : "DRAFT", submittedById: submitted ? ids.alice! : null },
        });
        await writeAuditEvent(tx, { actorId: ids.alice!, action: "seed.kyc.case.create", entityType: "KycCase", entityId: c.id, after: { status: c.status } });
      }
    });
  }

  if ((await prisma.refund.count()) === 0) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.refund.create({
        data: { customerName: "Jane Doe", accountNumber: "000123456789", amountCents: 12_550, reason: "Duplicate charge", submittedById: ids.carol! },
      });
      await writeAuditEvent(tx, { actorId: ids.carol!, action: "seed.refund.request", entityType: "Refund", entityId: r.id, after: { status: r.status, amountCents: r.amountCents } });
    });
  }

  if ((await prisma.kycReviewCase.count()) === 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const data of kycReviewSeedCases({ analyst: ids.alice!, approver: ids.bob! })) {
          const c = await tx.kycReviewCase.create({ data });
          await writeAuditEvent(tx, {
            actorId: c.submittedById ?? ids.alice!,
            action: "seed.kyc-review.case.create",
            entityType: "KycReviewCase",
            entityId: c.id,
            after: { status: c.status, riskScore: c.riskScore, assignedTo: c.assignedTo, recommendation: c.recommendation },
          });
        }
      },
      { timeout: 60_000 },
    );
  }

  console.log(`Seeded ${USERS.length} users: ${USERS.map((u) => `${u.username} (${u.roles.join(",")})`).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
