import { ApiProperty } from '@nestjs/swagger';
import { ASSESSMENT_LIMITS } from '../assessmentLimits.constants';
import {
  DecimalInRange,
  IsAssessmentDate,
  OptionalDecimalInRange,
  OptionalWholeInRange,
} from './assessmentValidators';

// Every value of an assessment. Required: date, weight, height. The rest are
// optional; sending the whole set on an edit replaces the stored one, so an
// omitted optional value is cleared.
export class AssessmentValuesDTO {
  @ApiProperty({
    example: '2026-09-15',
    description: 'Real date `YYYY-MM-DD`, not later than today (Brasília).',
  })
  @IsAssessmentDate()
  assessedOn: string;

  @DecimalInRange(ASSESSMENT_LIMITS.weightKg, 78.2)
  weightKg: number;

  @DecimalInRange(ASSESSMENT_LIMITS.heightCm, 179)
  heightCm: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.bodyFatPercent, 18.4)
  bodyFatPercent?: number;

  @OptionalWholeInRange(ASSESSMENT_LIMITS.restingHeartRate, 58)
  restingHeartRate?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.flexibilityCm, 22)
  flexibilityCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.circumferenceCm, 34)
  armCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.circumferenceCm, 99)
  chestCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.waistCm, 82)
  waistCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.circumferenceCm, 85)
  abdomenCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.hipCm, 97)
  hipCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.circumferenceCm, 56)
  thighCm?: number;

  @OptionalDecimalInRange(ASSESSMENT_LIMITS.circumferenceCm, 37)
  calfCm?: number;
}
