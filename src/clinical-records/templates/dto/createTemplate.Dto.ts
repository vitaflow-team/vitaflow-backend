import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TemplatePurpose } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { TemplateFieldDTO } from './templateField.Dto';

export class CreateTemplateDTO {
  @ApiProperty({ example: 'Anamnese padrão' })
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name: string;

  @ApiProperty({ enum: TemplatePurpose })
  @IsEnum(TemplatePurpose)
  purpose: TemplatePurpose;

  @ApiProperty({ type: [TemplateFieldDTO], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDTO)
  fields: TemplateFieldDTO[];
}
