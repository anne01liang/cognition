-- CreateEnum
CREATE TYPE "ToolRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'BUILDING', 'PR_OPEN', 'MERGED', 'FAILED');

-- CreateEnum
CREATE TYPE "ToolRiskTier" AS ENUM ('LOW', 'HIGH');

-- CreateTable
CREATE TABLE "ToolRequest" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "status" "ToolRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "riskTier" "ToolRiskTier" NOT NULL,
    "form" JSONB NOT NULL,
    "manifestYaml" TEXT NOT NULL,
    "estimatedAcus" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "submittedById" TEXT,
    "decidedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "buildStartedAt" TIMESTAMP(3),
    "devinSessionId" TEXT,
    "devinSessionUrl" TEXT,
    "prUrl" TEXT,
    "acusUsed" DOUBLE PRECISION,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolRequest_requestedById_idx" ON "ToolRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ToolRequest_status_idx" ON "ToolRequest"("status");

-- CreateIndex
CREATE INDEX "ToolRequest_team_approvedAt_idx" ON "ToolRequest"("team", "approvedAt");
