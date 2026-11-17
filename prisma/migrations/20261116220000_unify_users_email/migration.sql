-- unified-login-account ADR-001, ADR-003, ADR-007: one email is one account.
--
-- Hand-authored (Prisma's schema DSL cannot express a functional index).
-- 20261015223000_relax_users_email_unique let a staff row and a customer
-- row share one email. Google sign-in only looked at customer rows, so for
-- an email whose only account was a staff row it created a second, empty
-- account — and password and Google sign-in then entered different
-- accounts. This migration undoes that in one transaction: it first
-- corrects the pairs that exist, then makes a second one impossible.
--
-- Correction, per email (compared case-insensitively) held by two rows:
-- the older row is kept; the newer row's Google identity moves to it; the
-- newer row is deleted — but only when it owns nothing. Anything else
-- (three or more rows, both rows holding a Google identity, a newer row
-- that owns data) raises, which rolls the whole migration back: nothing is
-- half-changed and the index is not created. Exceptions name row ids,
-- never emails.
--
-- Running it again, or on a database without duplicates, changes nothing.
-- Stored emails are not rewritten.
--
-- prisma/checks/unify-users-email.sql exercises this body in a throwaway
-- schema; keep the two in step.

BEGIN;

DO $$
DECLARE
  duplicate RECORD;
  reference RECORD;
  keeper TEXT;
  newer TEXT;
  owns_data BOOLEAN;
  corrected INTEGER := 0;
BEGIN
  FOR duplicate IN
    SELECT array_agg("id" ORDER BY "createdAt", "id") AS ids
    FROM "Users"
    GROUP BY lower("email")
    HAVING count(*) > 1
  LOOP
    IF array_length(duplicate.ids, 1) > 2 THEN
      RAISE EXCEPTION
        'unify_users_email: more than two accounts share one email (ids: %)',
        array_to_string(duplicate.ids, ', ');
    END IF;

    keeper := duplicate.ids[1];
    newer := duplicate.ids[2];

    IF (SELECT count(*) FROM "OAuthIdentity"
        WHERE "userId" IN (keeper, newer)) > 1 THEN
      RAISE EXCEPTION
        'unify_users_email: both accounts hold a Google identity (older: %, newer: %)',
        keeper, newer;
    END IF;

    -- Ownership the catalog cannot see: gateway and academia identifiers on
    -- the row itself, and the three columns that reference a user without a
    -- foreign key.
    owns_data :=
      EXISTS (
        SELECT 1 FROM "Users"
        WHERE "id" = newer
          AND ("asaasCustomerId" IS NOT NULL
            OR "asaasSubscriptionId" IS NOT NULL
            OR "academiaId" IS NOT NULL))
      OR EXISTS (SELECT 1 FROM "Client" WHERE "user_id" = newer)
      OR EXISTS (SELECT 1 FROM "FormRecord" WHERE "recordedByUserId" = newer)
      OR EXISTS (
        SELECT 1 FROM "BackofficeViewAsSession" WHERE "targetUserId" = newer);

    IF owns_data THEN
      RAISE EXCEPTION
        'unify_users_email: the newer account is not empty (older: %, newer: %)',
        keeper, newer;
    END IF;

    -- Every foreign key that references Users, read from the catalog so a
    -- table added by a later feature is covered without editing this file.
    -- The identity and the tokens are the two things this correction moves
    -- or drops on purpose.
    FOR reference IN
      SELECT con.conrelid::regclass AS owner_table, att.attname AS owner_column
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = '"Users"'::regclass
        AND con.conrelid NOT IN (
          '"OAuthIdentity"'::regclass, '"UsersToken"'::regclass)
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
        reference.owner_table, reference.owner_column)
      INTO owns_data
      USING newer;

      IF owns_data THEN
        RAISE EXCEPTION
          'unify_users_email: the newer account owns rows in % (older: %, newer: %)',
          reference.owner_table, keeper, newer;
      END IF;
    END LOOP;

    UPDATE "OAuthIdentity" SET "userId" = keeper WHERE "userId" = newer;
    DELETE FROM "UsersToken" WHERE "userID" = newer;
    DELETE FROM "Users" WHERE "id" = newer;
    corrected := corrected + 1;
  END LOOP;

  RAISE NOTICE 'unify_users_email: % duplicated email(s) corrected', corrected;
END $$;

DROP INDEX IF EXISTS "Users_email_customer_key";
DROP INDEX IF EXISTS "Users_email_staff_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Users_email_key"
  ON "Users" (lower("email"));

COMMIT;
