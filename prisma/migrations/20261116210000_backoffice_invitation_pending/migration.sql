-- unified-login-account ADR-010: a staff invitation for an email that
-- already has an account no longer creates a second Users row. The offered
-- tier waits on the account itself until its owner accepts with their
-- password, and the emailed link is a token of its own type so it can never
-- replace, or be accepted by, an account-activation link.
--
-- Kept apart from the email-uniqueness migration (ADR-007): a value added
-- to an enum cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "TokenType" ADD VALUE 'BACKOFFICE_INVITATION';

-- AlterTable
ALTER TABLE "Users" ADD COLUMN "pendingBackofficeTier" "BackofficeTier";
