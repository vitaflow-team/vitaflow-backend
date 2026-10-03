import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import { TrimString } from './createStudent.Dto';
import {
  BRAZILIAN_PHONE,
  IsAgeBetween,
  STUDENT_MAX_AGE_YEARS,
  STUDENT_MIN_AGE_YEARS,
  STUDENT_NAME_MAX_LENGTH,
} from './studentValidators';

export class UpdateStudentDTO {
  @ApiProperty({
    required: false,
    example: 'Diego Martins',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(STUDENT_NAME_MAX_LENGTH)
  name?: string;

  @ApiProperty({
    required: false,
    description: 'Only accepted for a student without an account.',
  })
  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email?: string;

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
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'birthDate must be a valid date.' })
  @IsAgeBetween(STUDENT_MIN_AGE_YEARS, STUDENT_MAX_AGE_YEARS)
  birthDate?: Date;

  @ApiProperty({
    required: false,
    description:
      'Confirms linking the existing confirmed account that owns a new e-mail.',
  })
  @IsOptional()
  @IsBoolean()
  linkExistingAccount?: boolean;
}
