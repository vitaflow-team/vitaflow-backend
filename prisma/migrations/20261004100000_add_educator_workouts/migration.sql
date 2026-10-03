-- CreateEnum
CREATE TYPE "EducatorWorkoutStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EducatorExerciseSource" AS ENUM ('LIBRARY', 'FREE');

-- CreateTable
CREATE TABLE "EducatorWorkout" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weeklyFrequency" INTEGER,
    "status" "EducatorWorkoutStatus" NOT NULL DEFAULT 'DRAFT',
    "lastEditNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducatorWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducatorWorkoutSession" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "EducatorWorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducatorWorkoutExercise" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "EducatorExerciseSource" NOT NULL,
    "exerciseId" TEXT,
    "name" TEXT NOT NULL,
    "muscleGroup" TEXT NOT NULL,
    "equipment" "ExerciseEquipment",
    "sets" INTEGER NOT NULL,
    "reps" TEXT NOT NULL,
    "load" TEXT,
    "videoUrl" TEXT,

    CONSTRAINT "EducatorWorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EducatorWorkout_clientId_status_idx" ON "EducatorWorkout"("clientId", "status");

-- CreateIndex
CREATE INDEX "EducatorWorkoutSession_workoutId_idx" ON "EducatorWorkoutSession"("workoutId");

-- CreateIndex
CREATE INDEX "EducatorWorkoutExercise_sessionId_idx" ON "EducatorWorkoutExercise"("sessionId");

-- Hand-authored: the schema language cannot declare a partial unique index.
-- At most one ACTIVE workout per student record, even if a code path misses
-- the row lock taken at activation. A later `prisma migrate dev` may report
-- this index as drift; keep it.
CREATE UNIQUE INDEX "EducatorWorkout_one_active_per_client" ON "EducatorWorkout"("clientId") WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "EducatorWorkout" ADD CONSTRAINT "EducatorWorkout_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducatorWorkoutSession" ADD CONSTRAINT "EducatorWorkoutSession_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "EducatorWorkout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducatorWorkoutExercise" ADD CONSTRAINT "EducatorWorkoutExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EducatorWorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducatorWorkoutExercise" ADD CONSTRAINT "EducatorWorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
