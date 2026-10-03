import { ConsentFeature } from '@prisma/client';

// Single source of the assessment limits (mirrored by the frontend schema).
// Weight, height, waist and hip match the progress records' own limits, so
// every assessment can appear in "Minha evolução" without being rejected by it.
export const ASSESSMENT_LIMITS = {
  weightKg: { min: 20, max: 300 },
  heightCm: { min: 50, max: 250 },
  waistCm: { min: 30, max: 200 },
  hipCm: { min: 30, max: 200 },
  // Arm, chest, abdomen, thigh and calf.
  circumferenceCm: { min: 10, max: 200 },
  bodyFatPercent: { min: 1, max: 70 },
  restingHeartRate: { min: 30, max: 150 },
  flexibilityCm: { min: -50, max: 80 },
} as const;

export const ASSESSMENTS_PAGE_SIZE = 20;

// The educator's one-time health-data responsibility declaration.
export const DECLARATION_FEATURE: ConsentFeature =
  ConsentFeature.PHYSICAL_ASSESSMENT_RECORDING;

// Brazil has had no daylight saving since 2019; a fixed offset is enough
// (same decision as the Scheduling feature).
export const BRT_OFFSET_HOURS = 3;
