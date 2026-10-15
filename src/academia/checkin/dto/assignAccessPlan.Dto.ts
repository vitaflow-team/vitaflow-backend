import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AssignAccessPlanDTO {
  @ApiProperty({ description: 'Catalog AcademiaAccessPlan id to assign.' })
  @IsString()
  @IsNotEmpty()
  accessPlanId: string;
}
