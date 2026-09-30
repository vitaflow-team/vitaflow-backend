import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class EstimateCaloriesDto {
  @ApiProperty({ example: '1 banana e 2 ovos mexidos' })
  @IsString()
  @MinLength(1)
  description: string;
}
