-- Marks Vita Flow internal staff for BackofficeGuard. Defaults to false so
-- every existing account stays a regular user.
ALTER TABLE "Users" ADD COLUMN     "isBackoffice" BOOLEAN NOT NULL DEFAULT false;
