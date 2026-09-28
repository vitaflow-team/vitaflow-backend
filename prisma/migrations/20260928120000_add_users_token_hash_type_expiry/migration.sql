-- Existing rows hold the bare row id that was sent to users as the token and
-- have no hash, type or expiry to backfill. They are short-lived by design,
-- so they are dropped: any link issued before this migration stops working
-- (ADR-001).
DELETE FROM "UsersToken";

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('ACTIVATION', 'RECOVERY');

-- AlterTable
ALTER TABLE "UsersToken" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ADD COLUMN     "type" "TokenType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "UsersToken_tokenHash_key" ON "UsersToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UsersToken_userID_type_idx" ON "UsersToken"("userID", "type");
