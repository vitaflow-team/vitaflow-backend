import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { isRealCalendarDate, todayInBrt } from '../assessedOnTimestamp.util';

interface Range {
  min: number;
  max: number;
}

// A number with at most one decimal place inside the range. Text, `NaN`,
// infinities and out-of-range values are rejected, never coerced.
export function DecimalInRange(range: Range, example: number) {
  return applyDecorators(
    ApiProperty({ example, minimum: range.min, maximum: range.max }),
    IsNumber(
      { maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false },
      { message: '$property must be a number with at most one decimal place.' },
    ),
    Min(range.min),
    Max(range.max),
  );
}

export function OptionalDecimalInRange(range: Range, example: number) {
  return applyDecorators(
    IsOptional(),
    DecimalInRange(range, example),
    ApiProperty({
      required: false,
      example,
      minimum: range.min,
      maximum: range.max,
    }),
  );
}

export function OptionalWholeInRange(range: Range, example: number) {
  return applyDecorators(
    IsOptional(),
    ApiProperty({
      required: false,
      example,
      minimum: range.min,
      maximum: range.max,
    }),
    IsInt({ message: '$property must be a whole number.' }),
    Min(range.min),
    Max(range.max),
  );
}

// A real calendar date, `YYYY-MM-DD`, that is not later than today in
// Brasília time. Dates before the student's registration are allowed.
export function IsAssessmentDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isAssessmentDate',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'assessedOn must be a real date (YYYY-MM-DD) that is not in the future.',
        ...options,
      },
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            isRealCalendarDate(value) &&
            value <= todayInBrt()
          );
        },
      },
    });
}
