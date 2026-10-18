-- CreateEnum
CREATE TYPE "FitnessExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "MuscleFocus" AS ENUM ('CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ABDOMEN');

-- AlterTable
ALTER TABLE "FitnessProfile" ADD COLUMN     "experienceLevel" "FitnessExperienceLevel",
ADD COLUMN     "heightCm" DOUBLE PRECISION,
ADD COLUMN     "muscleFocus" "MuscleFocus",
ADD COLUMN     "restrictionDetail" TEXT,
ADD COLUMN     "sessionDurationMin" INTEGER,
ADD COLUMN     "weightKg" DOUBLE PRECISION;
