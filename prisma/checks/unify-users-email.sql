-- unified-login-account IT-001 through IT-004: the duplicate-email
-- correction and the unique index are correct, all-or-nothing and
-- repeatable.
--
-- Builds a throwaway schema with only the tables and columns the migration
-- reads or writes, points the search path at it, and installs the body of
-- 20261116220000_unify_users_email/migration.sql as a function (verbatim
-- apart from the BEGIN/COMMIT wrapper, which a function cannot contain).
-- Then seeds one scenario at a time and asserts:
--   IT-001  an empty newer account is removed, its Google identity and
--           nothing else moves to the older account, and Users_email_key
--           exists;
--   IT-002  a newer account that owns a measurement, is referenced by
--           Client.user_id, or carries a gateway id makes the migration
--           raise, with no row or index changed;
--   IT-003  three accounts on one email, and two accounts that both hold a
--           Google identity, make it raise and change nothing;
--   IT-004  a database without duplicates and a second run are no-ops, and
--           afterwards a case-variant of an existing email is refused.
-- Then drops the schema. Never touches public data.
--
-- Run:
--   npx prisma db execute \
--     --file prisma/checks/unify-users-email.sql \
--     --schema prisma/schema.prisma
--
-- Exit code 0 means every assertion held. A failure raises, which rolls the
-- whole DO block back, so the throwaway schema is never left behind.

DO $$
DECLARE
  v_schema CONSTANT text := 'unify_users_email_check';
  v_count bigint;
  v_raised boolean;
  v_message text;
BEGIN
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema);
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  -- Local to this transaction: every unqualified name below, including the
  -- ones inside the migration body, resolves in the throwaway schema.
  PERFORM set_config('search_path', v_schema, true);

  CREATE TABLE "Users" (
    "id"                  text PRIMARY KEY,
    "email"               text NOT NULL,
    "isBackoffice"        boolean NOT NULL DEFAULT false,
    "asaasCustomerId"     text,
    "asaasSubscriptionId" text,
    "academiaId"          text,
    "createdAt"           timestamp NOT NULL
  );
  CREATE UNIQUE INDEX "Users_email_customer_key"
    ON "Users" ("email") WHERE "isBackoffice" = false;
  CREATE UNIQUE INDEX "Users_email_staff_key"
    ON "Users" ("email") WHERE "isBackoffice" = true;

  CREATE TABLE "OAuthIdentity" (
    "id"     text PRIMARY KEY,
    "userId" text NOT NULL UNIQUE REFERENCES "Users" ("id")
  );
  CREATE TABLE "UsersToken" (
    "id"     text PRIMARY KEY,
    "userID" text NOT NULL REFERENCES "Users" ("id")
  );
  -- Stands for every table that owns user data through a foreign key.
  CREATE TABLE "MeasurementRecord" (
    "id"     text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "Users" ("id")
  );
  -- The three references that carry no foreign key.
  CREATE TABLE "Client" ("id" text PRIMARY KEY, "user_id" text);
  CREATE TABLE "FormRecord" (
    "id" text PRIMARY KEY, "recordedByUserId" text NOT NULL);
  CREATE TABLE "BackofficeViewAsSession" (
    "id" text PRIMARY KEY, "targetUserId" text);

  -- The migration body.
  CREATE FUNCTION apply_unify_users_email() RETURNS void
  LANGUAGE plpgsql AS $body$
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

    DROP INDEX IF EXISTS "Users_email_customer_key";
    DROP INDEX IF EXISTS "Users_email_staff_key";

    CREATE UNIQUE INDEX IF NOT EXISTS "Users_email_key"
      ON "Users" (lower("email"));
  END $body$;

  -- Runs the body the way the migration's transaction does: an exception
  -- undoes everything it had done. Returns the message, or NULL on success.
  CREATE FUNCTION try_unify_users_email() RETURNS text
  LANGUAGE plpgsql AS $try$
  BEGIN
    PERFORM apply_unify_users_email();
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END $try$;

  -- The pair every scenario starts from: an older staff account with data
  -- and a newer customer account that Google created on the same email.
  CREATE FUNCTION seed_pair() RETURNS void LANGUAGE plpgsql AS $seed$
  BEGIN
    TRUNCATE "MeasurementRecord", "OAuthIdentity", "UsersToken", "Client",
      "FormRecord", "BackofficeViewAsSession", "Users" CASCADE;
    INSERT INTO "Users" ("id", "email", "isBackoffice", "createdAt") VALUES
      ('older', 'pessoa@example.com', true,  '2026-01-14'),
      ('newer', 'Pessoa@Example.com', false, '2026-10-17'),
      ('other', 'outra@example.com',  false, '2026-05-01');
    INSERT INTO "OAuthIdentity" VALUES ('identity-1', 'newer');
    INSERT INTO "UsersToken" VALUES ('token-1', 'newer');
    INSERT INTO "MeasurementRecord" VALUES
      ('measurement-1', 'older'), ('measurement-2', 'other');
  END $seed$;

  ---------------------------------------------------------------- IT-002 --
  -- Each kind of ownership on the newer account refuses the correction.
  FOR v_count IN 1..3 LOOP
    PERFORM seed_pair();
    IF v_count = 1 THEN
      INSERT INTO "MeasurementRecord" VALUES ('measurement-3', 'newer');
    ELSIF v_count = 2 THEN
      INSERT INTO "Client" VALUES ('client-1', 'newer');
    ELSE
      UPDATE "Users" SET "asaasCustomerId" = 'cus_123' WHERE "id" = 'newer';
    END IF;

    v_message := try_unify_users_email();
    IF v_message IS NULL THEN
      RAISE EXCEPTION 'IT-002 FAILED: case % did not raise', v_count;
    END IF;
    IF v_message NOT LIKE '%older%' OR v_message LIKE '%@%' THEN
      RAISE EXCEPTION 'IT-002 FAILED: case % message must name ids and no email: %',
        v_count, v_message;
    END IF;
    IF (SELECT count(*) FROM "Users") <> 3
       OR (SELECT "userId" FROM "OAuthIdentity") <> 'newer'
       OR (SELECT count(*) FROM "UsersToken") <> 1 THEN
      RAISE EXCEPTION 'IT-002 FAILED: case % changed rows before raising', v_count;
    END IF;
    IF to_regclass('"Users_email_key"') IS NOT NULL
       OR to_regclass('"Users_email_customer_key"') IS NULL THEN
      RAISE EXCEPTION 'IT-002 FAILED: case % changed an index', v_count;
    END IF;
  END LOOP;

  ---------------------------------------------------------------- IT-003 --
  -- Three accounts on one email.
  PERFORM seed_pair();
  DROP INDEX "Users_email_customer_key";
  INSERT INTO "Users" ("id", "email", "isBackoffice", "createdAt")
    VALUES ('third', 'PESSOA@example.com', false, '2026-11-01');
  v_message := try_unify_users_email();
  IF v_message IS NULL OR v_message NOT LIKE '%more than two%' THEN
    RAISE EXCEPTION 'IT-003 FAILED: three accounts did not raise: %', v_message;
  END IF;
  IF (SELECT count(*) FROM "Users") <> 4 THEN
    RAISE EXCEPTION 'IT-003 FAILED: three accounts changed rows';
  END IF;
  DELETE FROM "Users" WHERE "id" = 'third';
  CREATE UNIQUE INDEX "Users_email_customer_key"
    ON "Users" ("email") WHERE "isBackoffice" = false;

  -- Both accounts hold a Google identity.
  PERFORM seed_pair();
  INSERT INTO "OAuthIdentity" VALUES ('identity-2', 'older');
  v_message := try_unify_users_email();
  IF v_message IS NULL OR v_message NOT LIKE '%both accounts hold%' THEN
    RAISE EXCEPTION 'IT-003 FAILED: two identities did not raise: %', v_message;
  END IF;
  IF (SELECT count(*) FROM "Users") <> 3
     OR (SELECT count(*) FROM "OAuthIdentity") <> 2 THEN
    RAISE EXCEPTION 'IT-003 FAILED: two identities changed rows';
  END IF;

  ---------------------------------------------------------------- IT-001 --
  PERFORM seed_pair();
  v_message := try_unify_users_email();
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'IT-001 FAILED: an empty newer account raised: %', v_message;
  END IF;
  IF EXISTS (SELECT 1 FROM "Users" WHERE "id" = 'newer') THEN
    RAISE EXCEPTION 'IT-001 FAILED: the newer account is still there';
  END IF;
  IF (SELECT "userId" FROM "OAuthIdentity" WHERE "id" = 'identity-1')
     IS DISTINCT FROM 'older' THEN
    RAISE EXCEPTION 'IT-001 FAILED: the Google identity did not move';
  END IF;
  IF (SELECT count(*) FROM "UsersToken") <> 0 THEN
    RAISE EXCEPTION 'IT-001 FAILED: the removed account left a token behind';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM "Users"
       WHERE "id" = 'older' AND "email" = 'pessoa@example.com'
         AND "isBackoffice" = true AND "createdAt" = '2026-01-14')
     OR (SELECT count(*) FROM "MeasurementRecord" WHERE "userId" = 'older') <> 1
     OR (SELECT count(*) FROM "Users" WHERE "id" = 'other') <> 1 THEN
    RAISE EXCEPTION 'IT-001 FAILED: the kept or an unrelated account changed';
  END IF;
  IF to_regclass('"Users_email_key"') IS NULL
     OR to_regclass('"Users_email_customer_key"') IS NOT NULL
     OR to_regclass('"Users_email_staff_key"') IS NOT NULL THEN
    RAISE EXCEPTION 'IT-001 FAILED: the indexes were not replaced';
  END IF;

  ---------------------------------------------------------------- IT-004 --
  -- Second run on the corrected data: nothing left to do.
  CREATE TABLE "UsersAfterFirstRun" AS SELECT * FROM "Users";
  v_message := try_unify_users_email();
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'IT-004 FAILED: the second run raised: %', v_message;
  END IF;
  SELECT count(*) INTO v_count FROM (
    (SELECT * FROM "Users" EXCEPT SELECT * FROM "UsersAfterFirstRun")
    UNION ALL
    (SELECT * FROM "UsersAfterFirstRun" EXCEPT SELECT * FROM "Users")) diff;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'IT-004 FAILED: the second run changed % row(s)', v_count;
  END IF;

  -- The index now refuses a case-variant of an existing email.
  v_raised := false;
  BEGIN
    INSERT INTO "Users" ("id", "email", "createdAt")
      VALUES ('variant', 'PESSOA@EXAMPLE.COM', '2026-11-16');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'IT-004 FAILED: a case-variant email was accepted';
  END IF;

  -- A database that never had a duplicate: still on the old indexes.
  DROP INDEX "Users_email_key";
  CREATE UNIQUE INDEX "Users_email_customer_key"
    ON "Users" ("email") WHERE "isBackoffice" = false;
  v_message := try_unify_users_email();
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'IT-004 FAILED: no duplicates raised: %', v_message;
  END IF;
  SELECT count(*) INTO v_count FROM (
    (SELECT * FROM "Users" EXCEPT SELECT * FROM "UsersAfterFirstRun")
    UNION ALL
    (SELECT * FROM "UsersAfterFirstRun" EXCEPT SELECT * FROM "Users")) diff;
  IF v_count <> 0 OR to_regclass('"Users_email_key"') IS NULL THEN
    RAISE EXCEPTION 'IT-004 FAILED: a run without duplicates changed data or left no index';
  END IF;

  EXECUTE format('DROP SCHEMA %I CASCADE', v_schema);
  RAISE NOTICE 'unify-users-email: IT-001, IT-002, IT-003 and IT-004 passed';
END $$;
