import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MEAL_LABEL_MAX_LENGTH,
  MEAL_TEXT_MAX_LENGTH,
  MEALS_PER_DAY_MAX,
} from '../mealPlanLimits.constants';

export class MealInputDTO {
  @ApiProperty({ example: 'Café da manhã' })
  @IsString()
  @IsNotEmpty({ message: 'label must not be blank.' })
  @MaxLength(MEAL_LABEL_MAX_LENGTH)
  label: string;

  @ApiProperty({
    example: '2 ovos mexidos, 1 fatia de pão integral, café sem açúcar',
  })
  @IsString()
  @MaxLength(MEAL_TEXT_MAX_LENGTH)
  text: string;
}

export class SaveDayDTO {
  @ApiProperty({ type: [MealInputDTO], maxItems: MEALS_PER_DAY_MAX })
  @IsArray()
  @ArrayMaxSize(MEALS_PER_DAY_MAX)
  @ValidateNested({ each: true })
  @Type(() => MealInputDTO)
  meals: MealInputDTO[];
}
