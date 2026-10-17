import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListNutritionistPatientsQueryDTO {
  @ApiProperty({
    required: false,
    description: 'Part of the name or e-mail; case and accent insensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
