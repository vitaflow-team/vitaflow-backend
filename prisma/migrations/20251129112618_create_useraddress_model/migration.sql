-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "district" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
