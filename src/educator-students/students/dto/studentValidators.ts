import { registerDecorator, ValidationOptions } from 'class-validator';

export const STUDENT_NAME_MAX_LENGTH = 120;
export const STUDENT_MIN_AGE_YEARS = 5;
export const STUDENT_MAX_AGE_YEARS = 120;

// Brazilian landline or mobile number, with or without mask: "(11) 98888-7777",
// "11988887777", "(11) 8888-7777".
export const BRAZILIAN_PHONE = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;

export function ageInYears(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hadBirthday =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() &&
      now.getUTCDate() >= birthDate.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age;
}

// A birth date that makes the student between `min` and `max` years old today.
export function IsAgeBetween(
  min: number,
  max: number,
  options?: ValidationOptions,
) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isAgeBetween',
      target: object.constructor,
      propertyName,
      options: {
        message: `birthDate must make the student between ${min} and ${max} years old.`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            return false;
          }
          const age = ageInYears(value, new Date());
          return age >= min && age <= max;
        },
      },
    });
}
