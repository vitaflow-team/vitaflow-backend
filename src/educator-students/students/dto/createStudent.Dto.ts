import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  BRAZILIAN_PHONE,
  IsAgeBetween,
  STUDENT_MAX_AGE_YEARS,
  STUDENT_MIN_AGE_YEARS,
  STUDENT_NAME_MAX_LENGTH,
} from './studentValidators';

export function TrimString(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' ? raw.trim() : raw;
  });
}

export class CreateStudentDTO {
  @ApiProperty({
    required: false,
    description:
      "Full name. Required when registering without an account; when linking an existing account it defaults to the account holder's name.",
    example: 'Diego Martins',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(STUDENT_NAME_MAX_LENGTH)
  name?: string;

  @ApiProperty({ example: 'diego.martins@exemplo.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    required: false,
    example: '(11) 98888-7777',
  })
  @IsOptional()
  @TrimString()
  @Matches(BRAZILIAN_PHONE, { message: 'phone must be a valid number.' })
  phone?: string;

  @ApiProperty({
    required: false,
    example: '1990-05-20',
    description: `Makes the student between ${STUDENT_MIN_AGE_YEARS} and ${STUDENT_MAX_AGE_YEARS} years old.`,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'birthDate must be a valid date.' })
  @IsAgeBetween(STUDENT_MIN_AGE_YEARS, STUDENT_MAX_AGE_YEARS)
  birthDate?: Date;

  @ApiProperty({
    description:
      'true links the existing confirmed account with this e-mail (after the educator confirmed who it is); false registers without an account.',
  })
  @IsBoolean()
  linkExistingAccount: boolean;
}
