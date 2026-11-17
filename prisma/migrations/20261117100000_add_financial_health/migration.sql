-- CreateEnum
CREATE TYPE "RecurringBillingStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'OVERDUE', 'PAID', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BackofficeAccessResource" AS ENUM ('FINANCIAL_DELINQUENT_LIST');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "recurringBillingId" TEXT;

-- CreateTable
CREATE TABLE "GymRecurringBilling" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accessPlanId" TEXT NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "customAmount" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecurringBillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GymRecurringBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "asaasSubscriptionId" TEXT,
    "productType" "ProductType" NOT NULL,
    "productName" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidAt" DATE,
    "paidAmountCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackofficeAccessLog" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "tier" "BackofficeTier" NOT NULL,
    "resource" "BackofficeAccessResource" NOT NULL,
    "page" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackofficeAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GymRecurringBilling_status_idx" ON "GymRecurringBilling"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_asaasPaymentId_key" ON "PlatformPayment"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "PlatformPayment_dueDate_idx" ON "PlatformPayment"("dueDate");

-- CreateIndex
CREATE INDEX "PlatformPayment_paidAt_idx" ON "PlatformPayment"("paidAt");

-- CreateIndex
CREATE INDEX "PlatformPayment_status_dueDate_idx" ON "PlatformPayment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlatformPayment_userId_status_idx" ON "PlatformPayment"("userId", "status");

-- CreateIndex
CREATE INDEX "BackofficeAccessLog_staffUserId_createdAt_idx" ON "BackofficeAccessLog"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_billingAccountId_dueDate_idx" ON "Invoice"("billingAccountId", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_billingAccountId_paidAt_idx" ON "Invoice"("billingAccountId", "paidAt");

-- CreateIndex
CREATE INDEX "Invoice_recurringBillingId_idx" ON "Invoice"("recurringBillingId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringBillingId_fkey" FOREIGN KEY ("recurringBillingId") REFERENCES "GymRecurringBilling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymRecurringBilling" ADD CONSTRAINT "GymRecurringBilling_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-authored (not expressible in the Prisma schema) ----------------------

-- A student has at most one live recurring billing (ADR-007): ended rows
-- are history and may repeat, ACTIVE rows may not.
CREATE UNIQUE INDEX "GymRecurringBilling_one_active_per_client_key" ON "GymRecurringBilling"("clientId") WHERE "status" = 'ACTIVE';

-- The due day is a calendar day every month has (1..28) and a fee is always
-- a positive amount.
ALTER TABLE "GymRecurringBilling" ADD CONSTRAINT "GymRecurringBilling_dueDay_range_check" CHECK ("dueDay" BETWEEN 1 AND 28);
ALTER TABLE "GymRecurringBilling" ADD CONSTRAINT "GymRecurringBilling_amountCents_positive_check" CHECK ("amountCents" > 0);
