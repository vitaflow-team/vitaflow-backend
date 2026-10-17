import { ProductType } from '@prisma/client';

// "CRN" for a nutritionist, "CREF" for a physical educator — one shared
// `registrationNumber` column, product-type-driven label (PRD ADR-009).
export function registrationLabelFor(type: ProductType): 'CRN' | 'CREF' | null {
  if (type === ProductType.NUTRITIONIST) return 'CRN';
  if (type === ProductType.PHYSICAL_EDUCATOR) return 'CREF';
  return null;
}
