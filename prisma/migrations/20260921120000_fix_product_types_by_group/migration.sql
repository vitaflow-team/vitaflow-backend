-- Fix: professional plans stored with the default type USER.
--
-- Data only — no schema change. Some databases were seeded before products
-- carried a type, so every product kept the column default (USER). The plan
-- catalog and route access both depend on the type, which made the Nutritionist
-- and Physical-educator plans show up under "Para você" and behave as personal
-- plans.
--
-- The seed already pairs each group with one type, so the type is restored from
-- the group name. Idempotent: it only touches rows whose type differs from the
-- expected one, so a second run updates nothing. Groups it does not know are
-- left alone.

UPDATE "Product" p
   SET type = 'NUTRITIONIST'
  FROM "ProductGroup" g
 WHERE p."groupId" = g.id
   AND g.name = 'Nutricionistas'
   AND p.type <> 'NUTRITIONIST';

UPDATE "Product" p
   SET type = 'PHYSICAL_EDUCATOR'
  FROM "ProductGroup" g
 WHERE p."groupId" = g.id
   AND g.name = 'Educadores físicos'
   AND p.type <> 'PHYSICAL_EDUCATOR';
