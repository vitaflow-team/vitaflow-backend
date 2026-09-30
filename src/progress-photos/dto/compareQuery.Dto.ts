import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CompareQueryDto {
  @ApiProperty({ description: 'First photo id' })
  @IsUUID()
  a: string;

  @ApiProperty({ description: 'Second photo id' })
  @IsUUID()
  b: string;
}
