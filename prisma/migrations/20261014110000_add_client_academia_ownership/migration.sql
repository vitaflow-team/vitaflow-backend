-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_professionalId_fkey";

-- DropIndex
DROP INDEX "Client_email_professionalId_key";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "academiaId" TEXT,
ALTER COLUMN "professionalId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Client_academiaId_idx" ON "Client"("academiaId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-authored (Prisma's schema DSL cannot express either): a Client always
-- has at least one owner of some kind (gym-foundation ADR-009).
ALTER TABLE "Client" ADD CONSTRAINT "Client_owner_check"
  CHECK ("academiaId" IS NOT NULL OR "professionalId" IS NOT NULL);

-- Preserves today's particular-student uniqueness exactly, scoped to rows
-- with no academia owner.
CREATE UNIQUE INDEX "Client_email_professionalId_particular_key"
  ON "Client" ("email", "professionalId") WHERE "academiaId" IS NULL;

-- A gym student's email is unique within the owning gym, independent of
-- whichever educator is currently assigned — reassignment never touches
-- this scope.
CREATE UNIQUE INDEX "Client_email_academiaId_gym_key"
  ON "Client" ("email", "academiaId") WHERE "academiaId" IS NOT NULL;
