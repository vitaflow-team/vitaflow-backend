import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { FormRecordValueInputDTO } from './formRecordValueInput.Dto';

export class UpdateFormRecordDTO {
  @ApiProperty({
    type: [FormRecordValueInputDTO],
    minItems: 1,
    description: 'Replaces the whole value set of this record.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FormRecordValueInputDTO)
  values: FormRecordValueInputDTO[];
}
