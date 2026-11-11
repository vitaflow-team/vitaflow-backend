import { ApiProperty } from '@nestjs/swagger';

// Workout completion cannot be measured in this release — no completion-log
// model exists for Workout or EducatorWorkout (ADR-010 in
// .compozy/tasks/role-management-dashboards/adrs/adr-010.md).
export class AdherenceSummaryDTO {
  // `type: Number` is required here: a property typed as the literal `null`
  // emits no usable design:type metadata, which makes @nestjs/swagger's
  // schema builder misread it as a circular class reference and crash the
  // whole Swagger document at boot (never exercised by Jest, which doesn't
  // call SwaggerModule.createDocument).
  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Always null in this release; see workoutTrackingUnavailable.',
  })
  workoutPercent: null;

  @ApiProperty({ example: true })
  workoutTrackingUnavailable: true;

  @ApiProperty({
    example: true,
    description:
      'Informational only — whether a Workout plan exists; does not affect workoutPercent.',
  })
  hasWorkoutPlan: boolean;

  @ApiProperty({ example: 66.7 })
  diaryPercent: number;
}
