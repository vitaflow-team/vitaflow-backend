-- Backfill: every plan-less account moves to Gratuito.
--
-- Data only — no schema change. Gratuito has no fixed id and no unique name
-- (two products are called Premium and two Profissional), so it is found by
-- the same rule the application uses: the USER product priced at zero with
-- no Stripe price id.
--
-- Idempotent: it only touches rows whose "productId" is still NULL, so a
-- second run updates nothing. If the free product is missing the whole
-- statement aborts and no row changes, rather than leaving accounts in a
-- half-migrated state.
--
-- Verified in a disposable schema by prisma/checks/free-plan-backfill.sql.

DO $$
DECLARE
  free_id text;
BEGIN
  SELECT id INTO free_id
    FROM "Product"
   WHERE type = 'USER'
     AND price = 0
     AND "stripeId" IS NULL
   LIMIT 1;

  IF free_id IS NULL THEN
    RAISE EXCEPTION 'Free product not found';
  END IF;

  UPDATE "Users" SET "productId" = free_id WHERE "productId" IS NULL;
END $$;
