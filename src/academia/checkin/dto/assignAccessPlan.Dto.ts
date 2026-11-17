import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { BillingTermsDTO } from '../../billing/dto/billingTerms.Dto';

export class AssignAccessPlanDTO {
  @ApiProperty({ description: 'Catalog AcademiaAccessPlan id to assign.' })
  @IsString()
  @IsNotEmpty()
  accessPlanId: string;

  @ApiProperty({
    required: false,
    type: BillingTermsDTO,
    description:
      'Fee terms: also starts the monthly recurring billing and issues the first fee.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingTermsDTO)
  billing?: BillingTermsDTO;
}
