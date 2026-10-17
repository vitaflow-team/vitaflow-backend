import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsUUID } from 'class-validator';

export class FormRecordValueInputDTO {
  @ApiProperty({ description: 'The TemplateField this value answers.' })
  @IsUUID()
  templateFieldId: string;

  @ApiProperty({
    description:
      'A string, number or boolean matching the field type; omit to leave an optional field unanswered.',
  })
  @IsDefined()
  value: string | number | boolean;
}
