-- ADR-010: platform subscription billing moves from Stripe to Asaas.
-- No live subscriber exists yet (ADR-010 context), so there is no row to
-- preserve or backfill.
--
-- `asaasCustomerId`/`asaasSubscriptionId` (and their unique indexes)
-- already exist on this shared dev database from earlier, uncommitted
-- work on this same migration — guarded with IF NOT EXISTS so this
-- migration is safe to apply regardless of whether that step already ran.
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT;
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Users_asaasCustomerId_key" ON "Users"("asaasCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Users_asaasSubscriptionId_key" ON "Users"("asaasSubscriptionId");

-- Stripe is fully removed by this task (subtask 6.8) — nothing in the
-- codebase reads these columns after this migration, so dropping them
-- now (rather than deferring to a follow-up migration) is safe.
ALTER TABLE "Users" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "Users" DROP COLUMN IF EXISTS "stripeSubscriptionId";

-- Product.stripeId has no Asaas-side equivalent: Asaas Checkout takes the
-- charge amount directly from Product.price at checkout-creation time,
-- there is nothing to pre-create or reference per product (TechSpec
-- addendum, "Data model mapping").
ALTER TABLE "Product" DROP COLUMN IF EXISTS "stripeId";
