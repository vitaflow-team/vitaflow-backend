import type { StudentAccessPlanData } from '@/repositories/academia/studentAccessPlan.repository';
import { AccessPlanValidityType, AcademiaAccessPlan } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

// The snapshot of a catalog plan a student is assigned (validity terms and
// price as they are now), shared by the plain assignment and the link that
// also starts recurring billing.
export function buildAssignment(
  catalogPlan: AcademiaAccessPlan,
  clientId: string,
  now: Date,
): StudentAccessPlanData {
  const expiresAt =
    catalogPlan.validityType === AccessPlanValidityType.DAYS
      ? new Date(now.getTime() + catalogPlan.validityValue * DAY_MS)
      : null;
  return {
    clientId,
    accessPlanId: catalogPlan.id,
    validityType: catalogPlan.validityType,
    validityValue: catalogPlan.validityValue,
    referencePrice: Number(catalogPlan.referencePrice),
    expiresAt,
  };
}
