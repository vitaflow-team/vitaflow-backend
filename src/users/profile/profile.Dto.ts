import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxDate,
  ValidateNested,
} from 'class-validator';
import { ProfileAddressDTO } from './profileAddress.Dto';

export class ProfileDTO {
  @ApiProperty({
    description: 'Full name of the user.',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty({ message: 'name is mandatory.' })
  name: string;

  @ApiProperty({
    description: 'Email address (must be unique).',
    example: 'johndoe@example.com',
  })
  @IsEmail({}, { message: 'Invalid email format.' })
  @IsNotEmpty({ message: 'email is mandatory.' })
  email: string;

  @ApiProperty({
    description: 'Password for account creation.',
    example: 'StrongPassword123',
  })
  @IsString()
  @IsNotEmpty({ message: 'password is mandatory.' })
  password: string;

  @ApiProperty({
    description: 'Phone number including area code.',
    example: '(11) 98888-7777',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'User birth date in ISO format.',
    example: '1990-05-20',
  })
  @Type(() => Date)
  @IsDate()
  @IsDateString({}, { message: 'birthDate must be a valid date.' })
  @IsNotEmpty({ message: 'birthDate is mandatory.' })
  @MaxDate(new Date(), { message: 'Birth date cannot be in the future.' })
  birthDate: string;

  @ApiProperty({
    description: 'User avatar URL.',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsString()
  @IsOptional()
  avatar?: string;

  @ApiProperty({ type: ProfileAddressDTO })
  @ValidateNested()
  @Type(() => ProfileAddressDTO)
  address: ProfileAddressDTO;
}
