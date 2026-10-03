import { applyDecorators } from '@nestjs/common';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { VIDEO_URL_MAX } from '../workoutLimits.constants';

export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A link a person can open in a browser: http or https, no whitespace. */
export function IsHttpUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isHttpUrl',
      target: object.constructor,
      propertyName,
      options: {
        message: '$property must be an http or https link.',
        ...options,
      },
      validator: { validate: isHttpUrl },
    });
}

// Trims text and reads a blank one as "not provided".
export function TrimToUndefined(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    if (typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  });
}

/** An optional external video link (http or https, at most 500 characters). */
export function OptionalVideoUrl() {
  return applyDecorators(
    IsOptional(),
    TrimToUndefined(),
    IsString(),
    MaxLength(VIDEO_URL_MAX),
    IsHttpUrl(),
  );
}
