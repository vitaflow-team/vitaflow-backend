import { ApiProperty } from '@nestjs/swagger';
import { FormFieldType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class TemplateFieldDTO {
  @ApiProperty({ example: 'Peso (kg)' })
  @IsString()
  @IsNotEmpty({ message: 'label must not be blank.' })
  label: string;

  @ApiProperty({ enum: FormFieldType })
  @IsEnum(FormFieldType)
  fieldType: FormFieldType;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Required (non-empty) iff fieldType is MULTIPLE_CHOICE.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description: 'NUMBER fields in an ASSESSMENT template only.',
  })
  @IsOptional()
  @IsBoolean()
  weightRole?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description: 'NUMBER fields in an ASSESSMENT template only.',
  })
  @IsOptional()
  @IsBoolean()
  heightRole?: boolean;
}
