-- AlterEnum
ALTER TYPE "ChurnRiskReason" ADD VALUE 'NO_CONTACT';
ALTER TYPE "ChurnRiskReason" ADD VALUE 'NO_DIARY_ENTRY';
ALTER TYPE "ChurnRiskReason" ADD VALUE 'OVERDUE_PAYMENT';

-- AlterTable
ALTER TABLE "Users" ADD COLUMN "independentChurnRiskBaselineAt" TIMESTAMP(3);
