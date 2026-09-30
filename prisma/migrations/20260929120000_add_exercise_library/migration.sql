-- CreateEnum
CREATE TYPE "ExerciseEquipment" AS ENUM ('GYM', 'HOME_BASIC', 'BODYWEIGHT');

-- CreateEnum
CREATE TYPE "ExerciseContraindication" AS ENUM ('SHOULDER', 'KNEE', 'SPINE', 'WRIST', 'HIP', 'ANKLE', 'CARDIAC');

-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "muscleGroup" TEXT NOT NULL,
    "primaryMuscles" TEXT[],
    "secondaryMuscles" TEXT[],
    "equipment" "ExerciseEquipment" NOT NULL,
    "contraindications" "ExerciseContraindication"[],
    "difficulty" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'APPROVED',
    "sourceAttribution" TEXT,
    "sourceLicense" TEXT,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exercise_status_idx" ON "Exercise"("status");

-- CreateIndex
CREATE INDEX "Exercise_equipment_idx" ON "Exercise"("equipment");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

