-- CreateTable
CREATE TABLE "ClientNutritionProfile" (
    "clientId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "restrictions" TEXT NOT NULL,
    "targetCalories" INTEGER,
    "mealsPerDay" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNutritionProfile_pkey" PRIMARY KEY ("clientId")
);

-- AddForeignKey
ALTER TABLE "ClientNutritionProfile" ADD CONSTRAINT "ClientNutritionProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
