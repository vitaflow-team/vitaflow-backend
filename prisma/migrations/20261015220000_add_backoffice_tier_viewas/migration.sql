-- CreateEnum
CREATE TYPE "BackofficeTier" AS ENUM ('EQUIPE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ViewAsTargetKind" AS ENUM ('USER', 'ACADEMIA_STAFF');

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "backofficeTier" "BackofficeTier";

-- CreateTable
CREATE TABLE "BackofficeViewAsSession" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "targetKind" "ViewAsTargetKind" NOT NULL,
    "targetUserId" TEXT,
    "targetStaffId" TEXT,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackofficeViewAsSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackofficeViewAsSession_staffUserId_startedAt_idx" ON "BackofficeViewAsSession"("staffUserId", "startedAt");

-- CreateIndex
CREATE INDEX "BackofficeViewAsSession_endedAt_expiresAt_idx" ON "BackofficeViewAsSession"("endedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "BackofficeViewAsSession" ADD CONSTRAINT "BackofficeViewAsSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migration default (platform-admin-access ADR-005): every pre-existing
-- isBackoffice row predates backofficeTier and gets the least-privilege
-- default. This PRD's "at least one admin interno must always remain"
-- business rule then requires an operator to manually promote at least one
-- such row to ADMIN directly in the database as part of deploying this
-- migration — see this migration's PR description for the exact step.
UPDATE "Users" SET "backofficeTier" = 'EQUIPE' WHERE "isBackoffice" = true;
