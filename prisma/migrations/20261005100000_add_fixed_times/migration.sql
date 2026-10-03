-- CreateEnum
CREATE TYPE "FixedSessionStatus" AS ENUM ('SCHEDULED', 'CANCELED');

-- CreateTable
CREATE TABLE "FixedTime" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "type" "SessionType" NOT NULL,
    "onlineLink" TEXT,
    "workoutLetter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedSession" (
    "id" TEXT NOT NULL,
    "fixedTimeId" TEXT,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "FixedSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "canceledBy" TEXT,
    "type" "SessionType" NOT NULL,
    "onlineLink" TEXT,
    "workoutLetter" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedTime_professionalId_idx" ON "FixedTime"("professionalId");

-- CreateIndex
CREATE INDEX "FixedTime_clientId_idx" ON "FixedTime"("clientId");

-- CreateIndex
CREATE INDEX "FixedSession_professionalId_startAt_idx" ON "FixedSession"("professionalId", "startAt");

-- CreateIndex
CREATE INDEX "FixedSession_clientId_startAt_idx" ON "FixedSession"("clientId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "FixedSession_fixedTimeId_startAt_key" ON "FixedSession"("fixedTimeId", "startAt");

-- AddForeignKey
ALTER TABLE "FixedTime" ADD CONSTRAINT "FixedTime_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedTime" ADD CONSTRAINT "FixedTime_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedSession" ADD CONSTRAINT "FixedSession_fixedTimeId_fkey" FOREIGN KEY ("fixedTimeId") REFERENCES "FixedTime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedSession" ADD CONSTRAINT "FixedSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedSession" ADD CONSTRAINT "FixedSession_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
