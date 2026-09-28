import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxDate,
} from 'class-validator';

export class ClientRegisterDTO {
  @ApiProperty({
    description:
      'Id of an existing client to update. Omit it to create a new client.',
    example: '01890a5d-ac96-774b-bcce-b302099a8057',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    description: 'Full name of the client.',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty({ message: 'name is mandatory.' })
  name: string;

  @ApiProperty({
    description: 'Phone number including area code.',
    example: '(11) 98888-7777',
    required: false,
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description: 'Client email address.',
    example: 'johndoe@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: 'Email is mandatory.' })
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  email: string;

  @ApiProperty({
    description: 'Client birth date in ISO format.',
    example: '1990-05-20',
  })
  @Type(() => Date)
  @IsDate({ message: 'birthDate must be a valid date.' })
  @IsOptional()
  @MaxDate(new Date(), { message: 'Birth date cannot be in the future.' })
  birthDate: Date;
}
