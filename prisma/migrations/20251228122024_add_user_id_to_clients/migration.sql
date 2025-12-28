-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "Client_email_idx" ON "Client"("email");
