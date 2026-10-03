import { ApiProperty } from '@nestjs/swagger';

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
}

// The binding read contract (TechSpec § Core Interfaces): every field below
// that isn't `professional` is explicitly null until a future professional-
// side PRD populates it — never omitted, never a fabricated placeholder.
export class NutritionistMirrorEntity {
  @ApiProperty({ type: MirrorProfessionalEntity })
  professional: MirrorProfessionalEntity;

  @ApiProperty({
    nullable: true,
    description: 'Populated by a future Nutricionista-module PRD.',
  })
  mealPlan: null;

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

// One of the educator's latest physical assessments as the student sees it.
export class MirrorAssessmentEntity {
  @ApiProperty() id: string;

  @ApiProperty({ example: '2026-09-15', description: 'Calendar date.' })
  assessedOn: string;

  @ApiProperty({ example: 78.2 }) weightKg: number;

  @ApiProperty({ example: 18.4, nullable: true, type: Number })
  bodyFatPercent: number | null;
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
