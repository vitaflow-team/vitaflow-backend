-- CreateTable
CREATE TABLE "MeasurementRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "heightCm" DOUBLE PRECISION NOT NULL,
    "waistCm" DOUBLE PRECISION,
    "hipCm" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeasurementRecord_userId_recordedAt_idx" ON "MeasurementRecord"("userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "MeasurementRecord" ADD CONSTRAINT "MeasurementRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
