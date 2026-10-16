-- CreateEnum
CREATE TYPE "TemplatePurpose" AS ENUM ('ANAMNESE', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'YES_NO', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "MealPlanStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterEnum: a true rename (not a recreate-and-cast), so any existing
-- FeatureConsent row already holding the old label keeps working — casting
-- text to a freshly recreated enum would fail for those rows instead.
ALTER TYPE "ConsentFeature" RENAME VALUE 'PHYSICAL_ASSESSMENT_RECORDING' TO 'HEALTH_RECORD_FILLING';

-- DropForeignKey
ALTER TABLE "PhysicalAssessment" DROP CONSTRAINT "PhysicalAssessment_clientId_fkey";

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "registrationNumber" TEXT;

-- DropTable: pre-production, no data migration (nutritionist-module PRD ADR-003).
DROP TABLE "PhysicalAssessment";

-- CreateTable
CREATE TABLE "AssessmentTemplate" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT,
    "academiaId" TEXT,
    "name" TEXT NOT NULL,
    "purpose" "TemplatePurpose" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "FormFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "weightRole" BOOLEAN NOT NULL DEFAULT false,
    "heightRole" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormRecordValue" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldType" "FormFieldType" NOT NULL,
    "weightRole" BOOLEAN NOT NULL DEFAULT false,
    "heightRole" BOOLEAN NOT NULL DEFAULT false,
    "textValue" TEXT,
    "numberValue" DOUBLE PRECISION,
    "boolValue" BOOLEAN,
    "selectedOption" TEXT,

    CONSTRAINT "FormRecordValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "MealPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanDay" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,

    CONSTRAINT "MealPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanMeal" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "MealPlanMeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentTemplate_professionalId_idx" ON "AssessmentTemplate"("professionalId");

-- CreateIndex
CREATE INDEX "AssessmentTemplate_academiaId_idx" ON "AssessmentTemplate"("academiaId");

-- CreateIndex
CREATE INDEX "TemplateField_templateId_position_idx" ON "TemplateField"("templateId", "position");

-- CreateIndex
CREATE INDEX "FormRecord_clientId_recordedAt_idx" ON "FormRecord"("clientId", "recordedAt");

-- CreateIndex
CREATE INDEX "FormRecordValue_recordId_idx" ON "FormRecordValue"("recordId");

-- CreateIndex
CREATE INDEX "MealPlan_clientId_version_idx" ON "MealPlan"("clientId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanDay_mealPlanId_weekday_key" ON "MealPlanDay"("mealPlanId", "weekday");

-- CreateIndex
CREATE INDEX "MealPlanMeal_dayId_position_idx" ON "MealPlanMeal"("dayId", "position");

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecordValue" ADD CONSTRAINT "FormRecordValue_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "FormRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanDay" ADD CONSTRAINT "MealPlanDay_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanMeal" ADD CONSTRAINT "MealPlanMeal_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "MealPlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-authored (Prisma's schema DSL cannot express it): a template's owner
-- is exactly one of professionalId/academiaId, never both, never neither
-- (nutritionist-module ADR-010, mirroring Client_owner_check's pattern).
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_owner_check"
  CHECK (
    ("professionalId" IS NOT NULL AND "academiaId" IS NULL)
    OR ("professionalId" IS NULL AND "academiaId" IS NOT NULL)
  );

-- Hand-authored: the schema language cannot declare a partial unique index.
-- At most one DRAFT-status meal plan per client, mirroring
-- EducatorWorkout_one_active_per_client's exact shape (add_educator_workouts
-- migration). A later `prisma migrate dev` may report this index as drift;
-- keep it.
CREATE UNIQUE INDEX "MealPlan_one_draft_per_client" ON "MealPlan"("clientId") WHERE "status" = 'DRAFT';
