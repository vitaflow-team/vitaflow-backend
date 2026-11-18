-- CreateEnum
CREATE TYPE "PushDeviceStatus" AS ENUM ('ACTIVE', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "ReengagementKind" AS ENUM ('DIARY_INACTIVITY', 'CHECKIN_ABSENCE');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushHeldAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "status" "PushDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushCategoryPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "PushCategoryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSettings" (
    "userId" TEXT NOT NULL,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStartMinute" INTEGER NOT NULL DEFAULT 1320,
    "quietEndMinute" INTEGER NOT NULL DEFAULT 420,
    "diaryReminderMinute" INTEGER NOT NULL DEFAULT 1140,
    "invitationShownAt" TIMESTAMP(3),

    CONSTRAINT "PushSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReengagementEpisode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReengagementKind" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ReengagementEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReengagementPush" (
    "userId" TEXT NOT NULL,
    "dateKey" DATE NOT NULL,
    "kind" "ReengagementKind",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReengagementPush_pkey" PRIMARY KEY ("userId","dateKey")
);

-- CreateTable
CREATE TABLE "ReengagementBaseline" (
    "kind" "ReengagementKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReengagementBaseline_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_endpoint_key" ON "PushDevice"("endpoint");

-- CreateIndex
CREATE INDEX "PushDevice_userId_status_idx" ON "PushDevice"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushCategoryPreference_userId_category_key" ON "PushCategoryPreference"("userId", "category");

-- CreateIndex
CREATE INDEX "ReengagementEpisode_kind_endedAt_idx" ON "ReengagementEpisode"("kind", "endedAt");

-- CreateIndex
CREATE INDEX "ReengagementEpisode_userId_idx" ON "ReengagementEpisode"("userId");

-- Hand-written (Prisma has no DSL for partial indexes): one open episode per
-- subject and kind; a new episode can only start once the previous one ended.
CREATE UNIQUE INDEX "ReengagementEpisode_one_open" ON "ReengagementEpisode"("kind", "scopeKey") WHERE "endedAt" IS NULL;

-- Hand-written: the quiet-hours flush only scans notifications still held.
CREATE INDEX "Notification_push_held" ON "Notification"("userId") WHERE "pushHeldAt" IS NOT NULL;
