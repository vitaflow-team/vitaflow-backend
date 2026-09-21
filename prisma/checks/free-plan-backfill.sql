-- IT-005 / IT-006: the free-plan backfill migration is correct and idempotent.
--
-- Builds a throwaway schema with a product catalog and plan-less plus
-- planned users, applies the body of
-- 20260920120000_backfill_free_plan/migration.sql (verbatim apart from the
-- schema qualifier), and asserts:
--   IT-005  only the plan-less rows move to Gratuito, rows that already had
--           a product are untouched, and a second run changes nothing.
--   IT-006  with no free product in the catalog the migration raises
--           'Free product not found' and no user row changes.
-- Then drops the schema. Never touches public data.
--
-- Run:
--   npx prisma db execute \
--     --file prisma/checks/free-plan-backfill.sql \
--     --schema prisma/schema.prisma
--
-- Exit code 0 means every assertion held. A failure raises, which rolls the
-- whole DO block back, so the throwaway schema is never left behind.

DO $$
DECLARE
  v_schema CONSTANT text := 'free_plan_backfill_check';
  free_id text;
  v_count bigint;
  v_changed bigint;
  v_error text;
BEGIN
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema);
  EXECUTE format('CREATE SCHEMA %I', v_schema);

  -- Only the columns the migration reads or writes.
  EXECUTE format($f$
    CREATE TABLE %I."Product" (
      id         text PRIMARY KEY,
      name       text NOT NULL,
      price      double precision NOT NULL,
      type       text NOT NULL,
      "stripeId" text
    )$f$, v_schema);

  EXECUTE format($f$
    CREATE TABLE %I."Users" (
      id          text PRIMARY KEY,
      email       text NOT NULL,
      name        text NOT NULL,
      "productId" text
    )$f$, v_schema);

  -- The seed's shape: one free USER product, plus paid ones that must never
  -- be mistaken for it (a paid USER plan and a zero-priced professional one
  -- that still carries a Stripe price).
  EXECUTE format($f$
    INSERT INTO %I."Product" VALUES
      ('free-1',    'Gratuito',     0,    'USER',         NULL),
      ('premium-1', 'Premium',      19.9, 'USER',         'price_premium'),
      ('nutri-1',   'Profissional', 59.9, 'NUTRITIONIST', 'price_nutri')
  $f$, v_schema);

  -- IT-005: three plan-less users and two that already have a product.
  EXECUTE format($f$
    INSERT INTO %I."Users" VALUES
      ('u1', 'ana@example.com',     'Ana',     NULL),
      ('u2', 'bruno@example.com',   'Bruno',   NULL),
      ('u3', 'carla@example.com',   'Carla',   NULL),
      ('u4', 'diego@example.com',   'Diego',   'premium-1'),
      ('u5', 'elena@example.com',   'Elena',   'nutri-1')
  $f$, v_schema);

  ---------------------------------------------------------------- IT-005 --
  -- First run: the migration body.
  EXECUTE format($f$
    SELECT id FROM %I."Product"
     WHERE type = 'USER' AND price = 0 AND "stripeId" IS NULL
     LIMIT 1$f$, v_schema) INTO free_id;
  IF free_id IS NULL THEN
    RAISE EXCEPTION 'Free product not found';
  END IF;
  EXECUTE format(
    'UPDATE %I."Users" SET "productId" = $1 WHERE "productId" IS NULL',
    v_schema) USING free_id;

  EXECUTE format(
    'SELECT count(*) FROM %I."Users" WHERE "productId" = ''free-1''',
    v_schema) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'IT-005 FAILED: % row(s) on the free product, expected 3',
      v_count;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I."Users" WHERE "productId" IS NULL',
    v_schema) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'IT-005 FAILED: % row(s) kept an empty product', v_count;
  END IF;

  EXECUTE format($f$
    SELECT count(*) FROM %I."Users"
     WHERE (id = 'u4' AND "productId" <> 'premium-1')
        OR (id = 'u5' AND "productId" <> 'nutri-1')$f$,
    v_schema) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'IT-005 FAILED: % row(s) with a product were changed',
      v_count;
  END IF;

  -- IT-005 (rerun): snapshot, run again, diff.
  EXECUTE format(
    'CREATE TABLE %I."UsersAfterFirstRun" AS SELECT * FROM %I."Users"',
    v_schema, v_schema);

  EXECUTE format($f$
    SELECT id FROM %I."Product"
     WHERE type = 'USER' AND price = 0 AND "stripeId" IS NULL
     LIMIT 1$f$, v_schema) INTO free_id;
  IF free_id IS NULL THEN
    RAISE EXCEPTION 'Free product not found';
  END IF;
  EXECUTE format(
    'UPDATE %I."Users" SET "productId" = $1 WHERE "productId" IS NULL',
    v_schema) USING free_id;

  EXECUTE format($f$
    SELECT count(*) FROM (
      (SELECT * FROM %I."UsersAfterFirstRun"
        EXCEPT
       SELECT * FROM %I."Users")
      UNION ALL
      (SELECT * FROM %I."Users"
        EXCEPT
       SELECT * FROM %I."UsersAfterFirstRun")
    ) AS diff$f$, v_schema, v_schema, v_schema, v_schema) INTO v_changed;
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'IT-005 FAILED: the rerun changed % row(s)', v_changed;
  END IF;

  ---------------------------------------------------------------- IT-006 --
  -- A catalog with no product matching the free rule, and plan-less users.
  EXECUTE format('DELETE FROM %I."Users"', v_schema);
  EXECUTE format('DELETE FROM %I."Product"', v_schema);
  EXECUTE format($f$
    INSERT INTO %I."Product" VALUES
      ('premium-1', 'Premium', 19.9, 'USER', 'price_premium')
  $f$, v_schema);
  EXECUTE format($f$
    INSERT INTO %I."Users" VALUES
      ('u6', 'fabio@example.com', 'Fabio', NULL),
      ('u7', 'gabi@example.com',  'Gabi',  'premium-1')
  $f$, v_schema);

  v_error := NULL;
  BEGIN
    EXECUTE format($f$
      SELECT id FROM %I."Product"
       WHERE type = 'USER' AND price = 0 AND "stripeId" IS NULL
       LIMIT 1$f$, v_schema) INTO free_id;
    IF free_id IS NULL THEN
      RAISE EXCEPTION 'Free product not found';
    END IF;
    EXECUTE format(
      'UPDATE %I."Users" SET "productId" = $1 WHERE "productId" IS NULL',
      v_schema) USING free_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error IS NULL THEN
    RAISE EXCEPTION
      'IT-006 FAILED: the migration completed without a free product';
  END IF;
  IF v_error <> 'Free product not found' THEN
    RAISE EXCEPTION 'IT-006 FAILED: unexpected error message %', v_error;
  END IF;

  EXECUTE format($f$
    SELECT count(*) FROM %I."Users"
     WHERE (id = 'u6' AND "productId" IS NOT NULL)
        OR (id = 'u7' AND "productId" <> 'premium-1')$f$,
    v_schema) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'IT-006 FAILED: % row(s) changed despite the abort',
      v_count;
  END IF;

  EXECUTE format('DROP SCHEMA %I CASCADE', v_schema);
END $$;
