-- AlterEnum
ALTER TYPE "ConsentFeature" ADD VALUE 'PHYSICAL_ASSESSMENT_RECORDING';

-- CreateTable
CREATE TABLE "PhysicalAssessment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assessedOn" DATE NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "heightCm" DOUBLE PRECISION NOT NULL,
    "bodyFatPercent" DOUBLE PRECISION,
    "restingHeartRate" INTEGER,
    "flexibilityCm" DOUBLE PRECISION,
    "armCm" DOUBLE PRECISION,
    "chestCm" DOUBLE PRECISION,
    "waistCm" DOUBLE PRECISION,
    "abdomenCm" DOUBLE PRECISION,
    "hipCm" DOUBLE PRECISION,
    "thighCm" DOUBLE PRECISION,
    "calfCm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhysicalAssessment_clientId_assessedOn_idx" ON "PhysicalAssessment"("clientId", "assessedOn");

-- AddForeignKey
ALTER TABLE "PhysicalAssessment" ADD CONSTRAINT "PhysicalAssessment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
