-- IT-010: the subscriptionCurrentPeriodEnd migration is additive and nullable.
--
-- Builds a throwaway schema with pre-migration "Users" rows, applies the
-- ALTER from 20260919180000_add_subscription_current_period_end, asserts the
-- column exists and is nullable, every existing row kept NULL, and no other
-- column value changed — then drops the schema. Never touches public data.
--
-- Run:
--   npx prisma db execute \
--     --file prisma/checks/it-010-subscription-current-period-end.sql \
--     --schema prisma/schema.prisma
--
-- Exit code 0 means every assertion held. A failure raises, which rolls the
-- whole DO block back, so the throwaway schema is never left behind.

DO $$
DECLARE
  v_schema CONSTANT text := 'it010_period_end_check';
  v_nullable text;
  v_type text;
  v_non_null bigint;
  v_changed bigint;
BEGIN
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema);
  EXECUTE format('CREATE SCHEMA %I', v_schema);

  -- The subscription mirror as it stands before this migration.
  EXECUTE format($f$
    CREATE TABLE %I."Users" (
      id                     text PRIMARY KEY,
      email                  text NOT NULL,
      name                   text NOT NULL,
      "productId"            text,
      "stripeCustomerId"     text,
      "stripeSubscriptionId" text,
      "subscriptionStatus"   text,
      "subscriptionCancelAt" TIMESTAMP(3)
    )$f$, v_schema);

  -- One subscriber, one row that never touched Stripe.
  EXECUTE format($f$
    INSERT INTO %I."Users" VALUES
      ('u1', 'ana@example.com',   'Ana',   'p1', 'cus_1', 'sub_1', 'active',
       TIMESTAMP '2026-11-01 00:00:00'),
      ('u2', 'bruno@example.com', 'Bruno', NULL, NULL,    NULL,    NULL, NULL)
  $f$, v_schema);

  EXECUTE format(
    'CREATE TABLE %I."UsersBefore" AS SELECT * FROM %I."Users"',
    v_schema, v_schema);

  -- The migration under test, verbatim apart from the schema qualifier.
  EXECUTE format(
    'ALTER TABLE %I."Users" ADD COLUMN "subscriptionCurrentPeriodEnd" TIMESTAMP(3)',
    v_schema);

  SELECT is_nullable, data_type
    INTO v_nullable, v_type
    FROM information_schema.columns
   WHERE table_schema = v_schema
     AND table_name = 'Users'
     AND column_name = 'subscriptionCurrentPeriodEnd';

  IF v_nullable IS NULL THEN
    RAISE EXCEPTION 'IT-010 FAILED: the column was not created';
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'IT-010 FAILED: the column is not nullable (is_nullable=%)',
      v_nullable;
  END IF;
  IF v_type <> 'timestamp without time zone' THEN
    RAISE EXCEPTION 'IT-010 FAILED: unexpected column type %', v_type;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I."Users" WHERE "subscriptionCurrentPeriodEnd" IS NOT NULL',
    v_schema) INTO v_non_null;
  IF v_non_null <> 0 THEN
    RAISE EXCEPTION 'IT-010 FAILED: % existing row(s) did not keep NULL',
      v_non_null;
  END IF;

  EXECUTE format($f$
    SELECT count(*) FROM (
      (SELECT * FROM %I."UsersBefore"
        EXCEPT
       SELECT id, email, name, "productId", "stripeCustomerId",
              "stripeSubscriptionId", "subscriptionStatus", "subscriptionCancelAt"
         FROM %I."Users")
      UNION ALL
      (SELECT id, email, name, "productId", "stripeCustomerId",
              "stripeSubscriptionId", "subscriptionStatus", "subscriptionCancelAt"
         FROM %I."Users"
        EXCEPT
       SELECT * FROM %I."UsersBefore")
    ) AS diff$f$, v_schema, v_schema, v_schema, v_schema) INTO v_changed;
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'IT-010 FAILED: % row(s) differ outside the new column',
      v_changed;
  END IF;

  EXECUTE format('DROP SCHEMA %I CASCADE', v_schema);
END $$;
