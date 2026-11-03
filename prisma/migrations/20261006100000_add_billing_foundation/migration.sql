-- CreateEnum
CREATE TYPE "ProductTier" AS ENUM ('FREE', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('ASAAS');

-- CreateEnum
CREATE TYPE "BillingAccountStatus" AS ENUM ('ACTIVE', 'REPLACED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'OVERDUE', 'PAID', 'PAID_MANUALLY', 'CANCELED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tier" "ProductTier" NOT NULL DEFAULT 'STANDARD';

-- Backfill the tier of existing plans: free plans, the Premium plan, the rest standard.
UPDATE "Product" SET "tier" = 'FREE' WHERE "price" = 0;
UPDATE "Product" SET "tier" = 'PREMIUM' WHERE "name" = 'Premium' AND "price" <> 0;

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "status" "BillingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountName" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "apiKeyFingerprint" TEXT NOT NULL,
    "webhookId" TEXT,
    "webhookTokenHash" TEXT NOT NULL,
    "keyInvalidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentTaxId" (
    "clientId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentTaxId_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "paymentUrl" TEXT,
    "paidAt" DATE,
    "paidAmountCents" INTEGER,
    "manualNote" TEXT,
    "linkSentAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "paidNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_webhookTokenHash_key" ON "BillingAccount"("webhookTokenHash");

-- CreateIndex
CREATE INDEX "BillingAccount_userId_idx" ON "BillingAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_billingAccountId_clientId_key" ON "BillingCustomer"("billingAccountId", "clientId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_competenceYear_competenceMonth_idx" ON "Invoice"("clientId", "competenceYear", "competenceMonth");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_billingAccountId_externalId_key" ON "Invoice"("billingAccountId", "externalId");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTaxId" ADD CONSTRAINT "StudentTaxId_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes (not expressible in the Prisma schema)
CREATE UNIQUE INDEX "Invoice_student_month_not_canceled_key" ON "Invoice"("clientId", "competenceYear", "competenceMonth") WHERE "status" <> 'CANCELED';
CREATE UNIQUE INDEX "BillingAccount_one_active_per_user_key" ON "BillingAccount"("userId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "BillingAccount_active_fingerprint_key" ON "BillingAccount"("apiKeyFingerprint") WHERE "status" = 'ACTIVE';
