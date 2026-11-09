-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'CHURN_RISK_ALERT';

-- AlterTable
ALTER TABLE "Academia" ADD COLUMN "churnRiskBaselineAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "ChurnRiskReason" AS ENUM ('CHECK_IN_INACTIVITY', 'ACCESS_PLAN_LAPSED');

-- CreateTable
CREATE TABLE "ChurnRiskEpisode" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reason" "ChurnRiskReason" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChurnRiskEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChurnRiskEpisode_clientId_reason_endedAt_idx" ON "ChurnRiskEpisode"("clientId", "reason", "endedAt");

-- AddForeignKey
ALTER TABLE "ChurnRiskEpisode" ADD CONSTRAINT "ChurnRiskEpisode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-authored partial unique index (churn-risk-alert ADR-009): at most one
-- OPEN (endedAt IS NULL) ChurnRiskEpisode per (clientId, reason) — the
-- backstop behind ChurnRiskEvaluationService's own open-episode diffing.
CREATE UNIQUE INDEX "ChurnRiskEpisode_one_open_per_client_reason" ON "ChurnRiskEpisode"("clientId", "reason") WHERE "endedAt" IS NULL;
