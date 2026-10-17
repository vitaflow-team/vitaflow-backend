import { ApiProperty } from '@nestjs/swagger';
import { FormFieldType, TemplatePurpose } from '@prisma/client';

export class TemplateFieldResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty() position: number;
  @ApiProperty() label: string;
  @ApiProperty({ enum: FormFieldType }) fieldType: FormFieldType;
  @ApiProperty({ type: [String] }) options: string[];
  @ApiProperty() required: boolean;
  @ApiProperty() weightRole: boolean;
  @ApiProperty() heightRole: boolean;
}

export class TemplateResponseDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: TemplatePurpose }) purpose: TemplatePurpose;
  @ApiProperty() active: boolean;
  @ApiProperty({ type: [TemplateFieldResponseDTO] })
  fields: TemplateFieldResponseDTO[];
}
