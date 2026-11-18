import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPushCategoryDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
