import { ProductType } from '@prisma/client';

// The API speaks Portuguese category names while the database keeps the
// original `ProductType` enum (renaming it would touch auth, the session and
// route access for no user-visible gain — ADR-002). This file is the single
// place the two vocabularies meet.
export const PLAN_CATEGORIES = [
  'USUARIO',
  'NUTRICIONISTA',
  'EDUCADOR_FISICO',
] as const;

export type PlanCategory = (typeof PLAN_CATEGORIES)[number];

const CATEGORY_TYPES: Record<PlanCategory, ProductType> = {
  USUARIO: 'USER',
  NUTRICIONISTA: 'NUTRITIONIST',
  EDUCADOR_FISICO: 'PHYSICAL_EDUCATOR',
};

export function typeOfCategory(category: PlanCategory): ProductType {
  return CATEGORY_TYPES[category];
}
