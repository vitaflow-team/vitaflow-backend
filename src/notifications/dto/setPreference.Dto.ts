import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPreferenceDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
