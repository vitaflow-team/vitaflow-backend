-- CreateEnum
CREATE TYPE "PhotoAngle" AS ENUM ('FRONT', 'SIDE', 'BACK');

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "angle" "PhotoAngle" NOT NULL,
    "storageFilename" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressPhoto_userId_angle_takenAt_idx" ON "ProgressPhoto"("userId", "angle", "takenAt");

-- AddForeignKey
ALTER TABLE "ProgressPhoto" ADD CONSTRAINT "ProgressPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
