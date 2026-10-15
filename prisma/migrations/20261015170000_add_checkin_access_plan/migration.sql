-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('SELF', 'RECEPTIONIST');

-- CreateEnum
CREATE TYPE "StudentAccessPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "source" "CheckInSource" NOT NULL,
    "registeredByStaffId" TEXT,
    "planValidAtCheckIn" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAccessPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accessPlanId" TEXT NOT NULL,
    "validityType" "AccessPlanValidityType" NOT NULL,
    "validityValue" INTEGER NOT NULL,
    "referencePrice" DECIMAL(10,2) NOT NULL,
    "status" "StudentAccessPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAccessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckIn_clientId_createdAt_idx" ON "CheckIn"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "StudentAccessPlan_clientId_idx" ON "StudentAccessPlan"("clientId");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAccessPlan" ADD CONSTRAINT "StudentAccessPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAccessPlan" ADD CONSTRAINT "StudentAccessPlan_accessPlanId_fkey" FOREIGN KEY ("accessPlanId") REFERENCES "AcademiaAccessPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-authored partial unique index (gym-checkin ADR-007): at most one
-- ACTIVE StudentAccessPlan per client, the backstop behind the lock-swap in
-- StudentAccessPlanRepository.activate().
CREATE UNIQUE INDEX "StudentAccessPlan_one_active_per_client" ON "StudentAccessPlan"("clientId") WHERE "status" = 'ACTIVE';
