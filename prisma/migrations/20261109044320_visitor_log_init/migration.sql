-- CreateEnum
CREATE TYPE "VisitNoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "VisitNote" (
    "id" TEXT NOT NULL,
    "roomLabel" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "VisitNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitNote_status_idx" ON "VisitNote"("status");
