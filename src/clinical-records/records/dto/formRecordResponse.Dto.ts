import { ApiProperty } from '@nestjs/swagger';
import { FormFieldType } from '@prisma/client';
import type { BmiClassification } from '@/progress/bmi.util';

export class FormRecordValueResponseDTO {
  @ApiProperty() fieldLabel: string;
  @ApiProperty({ enum: FormFieldType }) fieldType: FormFieldType;
  @ApiProperty({
    nullable: true,
    description: 'string | number | boolean | null',
  })
  value: string | number | boolean | null;
  @ApiProperty() weightRole: boolean;
  @ApiProperty() heightRole: boolean;
}

export class BmiResponseDTO {
  @ApiProperty() value: number;
  @ApiProperty() classification: BmiClassification;
}

export class FormRecordResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedByUserId: string;
  @ApiProperty({ type: [FormRecordValueResponseDTO] })
  values: FormRecordValueResponseDTO[];
  @ApiProperty({ type: BmiResponseDTO, nullable: true })
  bmi: BmiResponseDTO | null;
}
