-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('USER', 'NUTRITIONIST', 'PHYSICAL_EDUCATOR');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "type" "ProductType" NOT NULL DEFAULT 'USER';
