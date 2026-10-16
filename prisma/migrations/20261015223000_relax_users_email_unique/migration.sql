-- Hand-authored (Prisma's schema DSL cannot express a partial index): a
-- staff invitation (platform-admin-access ADR-005, task_02) must coexist
-- with a pre-existing customer account on the same email, as two entirely
-- separate Users rows. Dropping the blanket unique constraint and replacing
-- it with two scoped indexes preserves every existing uniqueness guarantee
-- within each side (a customer email is still globally unique among
-- customer rows; a staff email is still globally unique among staff rows)
-- while allowing exactly one of each to share an email.
DROP INDEX "Users_email_key";

CREATE UNIQUE INDEX "Users_email_customer_key"
  ON "Users" ("email") WHERE "isBackoffice" = false;

CREATE UNIQUE INDEX "Users_email_staff_key"
  ON "Users" ("email") WHERE "isBackoffice" = true;
