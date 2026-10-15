-- CreateEnum
CREATE TYPE "AcademiaInvitationKind" AS ENUM ('EMPLOYMENT', 'RECEPTIONIST');

-- CreateEnum
CREATE TYPE "AcademiaInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "AcademiaInvitation" (
    "id" TEXT NOT NULL,
    "academiaId" TEXT NOT NULL,
    "kind" "AcademiaInvitationKind" NOT NULL,
    "email" TEXT NOT NULL,
    "status" "AcademiaInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "educatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AcademiaInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" TEXT NOT NULL,
    "academiaId" TEXT NOT NULL,
    "educatorId" TEXT NOT NULL,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademiaInvitation_email_kind_status_idx" ON "AcademiaInvitation"("email", "kind", "status");

-- CreateIndex
CREATE INDEX "AcademiaInvitation_academiaId_status_idx" ON "AcademiaInvitation"("academiaId", "status");

-- CreateIndex
CREATE INDEX "Employment_academiaId_status_idx" ON "Employment"("academiaId", "status");

-- CreateIndex
CREATE INDEX "Employment_educatorId_status_idx" ON "Employment"("educatorId", "status");

-- AddForeignKey
ALTER TABLE "AcademiaInvitation" ADD CONSTRAINT "AcademiaInvitation_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_educatorId_fkey" FOREIGN KEY ("educatorId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-authored (Prisma's schema DSL cannot express a partial index): at
-- most one ACTIVE employment per (academiaId, educatorId) pair, belt-and-
-- suspenders alongside the service-layer check-then-act in EmploymentService
-- (gym-foundation ADR-004).
CREATE UNIQUE INDEX "Employment_one_active_per_pair" ON "Employment"("academiaId", "educatorId") WHERE "status" = 'ACTIVE';
