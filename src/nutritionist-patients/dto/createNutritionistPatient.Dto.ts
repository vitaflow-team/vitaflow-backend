import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BRAZILIAN_PHONE } from '@/educator-students/students/dto/studentValidators';

function trimString(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' ? raw.trim() : raw;
  });
}

export class CreateNutritionistPatientDTO {
  @ApiProperty({ example: 'Diego Martins' })
  @trimString()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  @MaxLength(255)
  name: string;

  @ApiProperty({
    required: false,
    example: 'diego.martins@exemplo.com',
    description:
      'At least one of email/phone is required. A matching confirmed account links immediately.',
  })
  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false, example: '(11) 98888-7777' })
  @IsOptional()
  @trimString()
  @Matches(BRAZILIAN_PHONE, { message: 'phone must be a valid number.' })
  phone?: string;
}
