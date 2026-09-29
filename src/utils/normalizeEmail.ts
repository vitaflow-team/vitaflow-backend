import { Transform, TransformFnParams } from 'class-transformer';

// Trims and lowercases an incoming email so lookups and stored addresses
// always use the same form. A non-string value passes through untouched so
// `@IsEmail()` rejects it instead of this transform throwing.
export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  });
}
