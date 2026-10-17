import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { FormRecordValueInputDTO } from './formRecordValueInput.Dto';

export class CreateFormRecordDTO {
  @ApiProperty()
  @IsUUID()
  templateId: string;

  @ApiProperty({ required: false, description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;

  @ApiProperty({ type: [FormRecordValueInputDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormRecordValueInputDTO)
  values: FormRecordValueInputDTO[];

  @ApiProperty({
    required: false,
    description:
      'Accepts the health-record consent declaration inline with the first FormRecord for this patient/student.',
  })
  @IsOptional()
  @IsBoolean()
  acceptDeclaration?: boolean;
}
