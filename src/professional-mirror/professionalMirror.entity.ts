import { ApiProperty } from '@nestjs/swagger';
import { Weekday } from '@prisma/client';

export class MirrorProfessionalEntity {
  @ApiProperty({ description: "The linked professional's user id." })
  id: string;

  @ApiProperty({ description: "The linked professional's full name." })
  name: string;

  @ApiProperty({
    description: 'Specialty text, null when the professional never set one.',
    nullable: true,
  })
  specialty: string | null;

  @ApiProperty({
    required: false,
    description:
      'CRN/CREF registration number. Omitted entirely when never set — never sent as null (PRD ADR-009).',
  })
  registrationNumber?: string;

  @ApiProperty({
    required: false,
    enum: ['CRN', 'CREF'],
    description: 'Present only alongside registrationNumber.',
  })
  registrationLabel?: 'CRN' | 'CREF';
}

export class MirrorMealPlanMealEntity {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() text: string;
}

export class MirrorMealPlanDayEntity {
  @ApiProperty({ enum: Weekday }) weekday: Weekday;

  @ApiProperty({ type: [MirrorMealPlanMealEntity] })
  meals: MirrorMealPlanMealEntity[];
}

export class MirrorMealPlanVersionEntity {
  @ApiProperty() version: number;
  @ApiProperty() publishedAt: string;
}

// One past published version's full content, fetched on demand
// (ADR-008: "access to prior versions' history") — distinct from
// MirrorMealPlanVersionEntity, which only lists version/date pairs.
export class MirrorMealPlanVersionContentEntity {
  @ApiProperty() version: number;
  @ApiProperty() publishedAt: string;

  @ApiProperty({ type: [MirrorMealPlanDayEntity] })
  days: MirrorMealPlanDayEntity[];
}

// The patient's current published meal plan, with access to its full
// version history (ADR-008) — null until the nutritionist has published at
// least one version.
export class MirrorMealPlanEntity {
  @ApiProperty() currentVersion: number;
  @ApiProperty() publishedAt: string;

  @ApiProperty({ type: [MirrorMealPlanDayEntity] })
  days: MirrorMealPlanDayEntity[];

  @ApiProperty({ type: [MirrorMealPlanVersionEntity] })
  versions: MirrorMealPlanVersionEntity[];
}

export class MirrorAssessmentValueEntity {
  @ApiProperty() fieldLabel: string;

  @ApiProperty({
    nullable: true,
    description: 'string | number | boolean | null',
  })
  value: string | number | boolean | null;
}

export class MirrorBmiEntity {
  @ApiProperty() value: number;
  @ApiProperty() classification: string;
}

// One filled clinical-records FormRecord (anamnese or assessment) as the
// patient/student sees it — its own frozen field values, plus derived BMI
// where applicable.
export class MirrorAssessmentEntity {
  @ApiProperty() id: string;

  @ApiProperty({ example: '2026-09-15T00:00:00.000Z' })
  recordedAt: string;

  @ApiProperty({ type: [MirrorAssessmentValueEntity] })
  values: MirrorAssessmentValueEntity[];

  @ApiProperty({ type: MirrorBmiEntity, nullable: true })
  bmi: MirrorBmiEntity | null;
}

// The binding read contract (TechSpec § Core Interfaces): every field below
// that isn't `professional` is explicitly null/empty until real data exists
// — never omitted, never a fabricated placeholder.
export class NutritionistMirrorEntity {
  @ApiProperty({ type: MirrorProfessionalEntity })
  professional: MirrorProfessionalEntity;

  @ApiProperty({
    type: MirrorAssessmentEntity,
    nullable: true,
    description:
      "The patient's current anamnese answers, or null when none exist yet.",
  })
  anamnese: MirrorAssessmentEntity | null;

  @ApiProperty({
    type: [MirrorAssessmentEntity],
    description:
      "The patient's full assessment history, newest first; an empty array when none exist yet (never null, per US-020.EC-1).",
  })
  assessmentHistory: MirrorAssessmentEntity[];

  @ApiProperty({
    type: MirrorMealPlanEntity,
    nullable: true,
    description:
      'The current published meal plan, or null when none exists yet.',
  })
  mealPlan: MirrorMealPlanEntity | null;

  @ApiProperty({
    nullable: true,
    description: 'Populated by the Scheduling PRD.',
  })
  nextConsultation: null;

  @ApiProperty({
    nullable: true,
    description: 'Populated by a future per-client-billing PRD.',
  })
  billingStatus: null;
}

export class MirrorWorkoutSessionEntity {
  @ApiProperty() id: string;

  @ApiProperty({ example: 'A', description: 'A, B, C… from the position.' })
  label: string;

  @ApiProperty() name: string;

  @ApiProperty() exerciseCount: number;
}

// The educator's current workout as a summary. "Today's workout" exists only
// through the schedule, so no session is marked as today's here.
export class MirrorWorkoutEntity {
  @ApiProperty() id: string;

  @ApiProperty() title: string;

  @ApiProperty({ nullable: true, type: Number })
  weeklyFrequency: number | null;

  @ApiProperty({ type: [MirrorWorkoutSessionEntity] })
  sessions: MirrorWorkoutSessionEntity[];

  @ApiProperty({ nullable: true, type: String })
  todaySessionId: string | null;
}

// The student's next time with the educator: a fixed session or a booking.
export class NextScheduleEntity {
  @ApiProperty() startAt: Date;

  @ApiProperty() endAt: Date;

  @ApiProperty({ enum: ['PRESENCIAL', 'ONLINE'] })
  type: 'PRESENCIAL' | 'ONLINE';

  @ApiProperty({ nullable: true, type: String })
  onlineLink: string | null;

  @ApiProperty({ nullable: true, type: String })
  workoutLetter: string | null;

  @ApiProperty({ nullable: true, type: String })
  workoutSessionName: string | null;
}

export class EducatorMirrorEntity {
  @ApiProperty({ type: MirrorProfessionalEntity })
  professional: MirrorProfessionalEntity;

  @ApiProperty({
    type: MirrorWorkoutEntity,
    nullable: true,
    description:
      "Summary of the educator's active workout for this student (distinct from the AI Workout Generator plan); null when none is active.",
  })
  todayWorkout: MirrorWorkoutEntity | null;

  @ApiProperty({
    type: NextScheduleEntity,
    nullable: true,
    description:
      'The next fixed session or booking with this educator; null when none.',
  })
  nextSchedule: NextScheduleEntity | null;

  @ApiProperty({
    type: [MirrorAssessmentEntity],
    nullable: true,
    description:
      "The educator's three latest physical assessments of this student, newest first; null when there are none.",
  })
  physicalAssessment: MirrorAssessmentEntity[] | null;

  @ApiProperty({
    nullable: true,
    description: 'Populated by a future per-client-billing PRD.',
  })
  billingStatus: null;
}

export class NoProfessionalEntity {
  @ApiProperty({ enum: [false] })
  hasProfessional: false;
}
