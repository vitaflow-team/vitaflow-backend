-- AlterEnum
ALTER TYPE "ProductType" ADD VALUE 'ACADEMIA';

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "academiaId" TEXT;

-- CreateTable
CREATE TABLE "Academia" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Academia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_academiaId_key" ON "Users"("academiaId");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
