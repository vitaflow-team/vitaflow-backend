import { ApiProperty } from '@nestjs/swagger';
import { AccessPlanValidityType } from '@prisma/client';
import type { AccessPlanStatus } from '@/academia/checkin/studentAccessPlan.service';

// The student's current plan at one gym, or the honest "nothing assigned"
// state. remaining is populated only when status is VALID (TechSpec §
// Data Models) — never a negative number, never a countdown on a lapsed
// plan.
export class CurrentAccessPlanEntity {
  @ApiProperty({ enum: ['NO_PLAN', 'VALID', 'EXPIRED', 'EXHAUSTED'] })
  status: AccessPlanStatus;

  @ApiProperty({ nullable: true, type: String }) planName: string | null;

  @ApiProperty({ enum: AccessPlanValidityType, nullable: true, type: String })
  validityType: AccessPlanValidityType | null;

  @ApiProperty({ nullable: true, type: Number }) validityValue: number | null;

  @ApiProperty({ nullable: true, type: Number }) remaining: number | null;
}

// One past assignment at a gym. endedAt is the ARCHIVED row's own
// updatedAt (TechSpec § Data Models) — activate() is the only path that
// archives a row, so it is an exact signal, not an approximation.
export class ArchivedAccessPlanEntity {
  @ApiProperty() id: string;
  @ApiProperty() planName: string;
  @ApiProperty({ enum: AccessPlanValidityType })
  validityType: AccessPlanValidityType;
  @ApiProperty() validityValue: number;
  @ApiProperty({ example: '2026-09-15T00:00:00.000Z' }) assignedAt: string;
  @ApiProperty({ example: '2026-10-15T00:00:00.000Z' }) endedAt: string;
}

// One gym membership, as the student sees it (US-001/US-002) — every
// membership the caller holds appears as one of these; "no memberships at
// all" is the empty array, not a sentinel (unlike NoProfessionalEntity on
// the professional mirrors), since "zero of several" needs no special
// shape the way "exactly one, absent" does.
export class AcademiaMembershipEntity {
  @ApiProperty() academiaId: string;
  @ApiProperty() academiaName: string;

  @ApiProperty({ type: CurrentAccessPlanEntity })
  currentPlan: CurrentAccessPlanEntity;

  @ApiProperty({ type: [ArchivedAccessPlanEntity] })
  history: ArchivedAccessPlanEntity[];
}
