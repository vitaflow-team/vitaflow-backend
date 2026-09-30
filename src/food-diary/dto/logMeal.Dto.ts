import { ApiProperty } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import { IsEnum, IsInt, IsString, Min, MinLength } from 'class-validator';

export class LogMealDto {
  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  mealType: MealType;

  @ApiProperty({ example: '1 banana e 2 ovos mexidos' })
  @IsString()
  @MinLength(1)
  description: string;

  @ApiProperty({
    example: 420,
    description: 'The final value — possibly edited from the AI estimate.',
  })
  @IsInt()
  @Min(1)
  calories: number;
}
