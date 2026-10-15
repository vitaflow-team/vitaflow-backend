-- CreateEnum
CREATE TYPE "AccessPlanValidityType" AS ENUM ('DAYS', 'VISITS');

-- CreateTable
CREATE TABLE "AcademiaAccessPlan" (
    "id" TEXT NOT NULL,
    "academiaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validityType" "AccessPlanValidityType" NOT NULL,
    "validityValue" INTEGER NOT NULL,
    "referencePrice" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademiaAccessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademiaAccessPlan_academiaId_idx" ON "AcademiaAccessPlan"("academiaId");

-- AddForeignKey
ALTER TABLE "AcademiaAccessPlan" ADD CONSTRAINT "AcademiaAccessPlan_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
