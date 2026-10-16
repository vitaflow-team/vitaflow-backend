import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { TemplateFieldDTO } from './templateField.Dto';

export class UpdateTemplateDTO {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name?: string;

  @ApiProperty({
    required: false,
    type: [TemplateFieldDTO],
    minItems: 1,
    description:
      'Replaces the whole field list when sent; past FormRecords keep their own frozen values regardless.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDTO)
  fields?: TemplateFieldDTO[];
}
