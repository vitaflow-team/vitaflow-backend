-- CreateEnum
CREATE TYPE "ConsentFeature" AS ENUM ('PROGRESS_PHOTOS');

-- CreateTable
CREATE TABLE "FeatureConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "ConsentFeature" NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureConsent_userId_feature_key" ON "FeatureConsent"("userId", "feature");

-- AddForeignKey
ALTER TABLE "FeatureConsent" ADD CONSTRAINT "FeatureConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
