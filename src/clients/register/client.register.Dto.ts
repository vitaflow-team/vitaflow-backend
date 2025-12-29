import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxDate,
} from 'class-validator';

export class ClientRegisterDTO {
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
  @IsNotEmpty({ message: 'Email is mandatory.' })
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
