-- AlterTable
ALTER TABLE "AcademiaInvitation" ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "AcademiaStaffMember" (
    "id" TEXT NOT NULL,
    "academiaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademiaStaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademiaStaffMemberToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademiaStaffMemberToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademiaStaffMember_email_key" ON "AcademiaStaffMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AcademiaStaffMemberToken_tokenHash_key" ON "AcademiaStaffMemberToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AcademiaStaffMemberToken_staffMemberId_idx" ON "AcademiaStaffMemberToken"("staffMemberId");

-- AddForeignKey
ALTER TABLE "AcademiaStaffMember" ADD CONSTRAINT "AcademiaStaffMember_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademiaStaffMemberToken" ADD CONSTRAINT "AcademiaStaffMemberToken_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "AcademiaStaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
