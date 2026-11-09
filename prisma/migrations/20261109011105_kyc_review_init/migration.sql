-- CreateEnum
CREATE TYPE "KycReviewRecommendation" AS ENUM ('APPROVE', 'REJECT', 'ESCALATE');

-- CreateTable
CREATE TABLE "KycReviewCase" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "ssn" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedTo" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "recommendation" "KycReviewRecommendation",
    "recommendationReason" TEXT,
    "submittedById" TEXT,
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycReviewCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycReviewCase_status_idx" ON "KycReviewCase"("status");

-- CreateIndex
CREATE INDEX "KycReviewCase_assignedTo_idx" ON "KycReviewCase"("assignedTo");

-- CreateIndex
CREATE INDEX "KycReviewCase_slaDueAt_idx" ON "KycReviewCase"("slaDueAt");
