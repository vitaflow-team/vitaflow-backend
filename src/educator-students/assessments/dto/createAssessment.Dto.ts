import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { AssessmentValuesDTO } from './assessmentValues.Dto';

export class CreateAssessmentDTO extends AssessmentValuesDTO {
  @ApiProperty({
    required: false,
    description:
      'Send true to accept the health-data responsibility declaration together with the first assessment. Ignored once it was accepted.',
  })
  @IsOptional()
  @IsBoolean()
  acceptDeclaration?: boolean;
}
