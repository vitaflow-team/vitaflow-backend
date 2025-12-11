import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxDate,
} from 'class-validator';

export class ProfileDTO {
  @ApiProperty({
    description: 'Full name of the user.',
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
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'User birth date in ISO format.',
    example: '1990-05-20',
  })
  @Type(() => Date)
  @IsDate({ message: 'birthDate must be a valid date.' })
  @IsOptional()
  @MaxDate(new Date(), { message: 'Birth date cannot be in the future.' })
  birthDate: Date;

  @ApiProperty({
    description: 'User avatar URL.',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  @IsString()
  @IsOptional()
  avatar?: string;

  @ApiProperty({
    description: 'Primary address line (street and number).',
    example: 'Av. Paulista, 1000',
  })
  @IsString()
  @IsNotEmpty({ message: 'addressLine1 is mandatory.' })
  addressLine1: string;

  @ApiProperty({
    description: 'Additional address information, such as apartment or suite.',
    example: 'Apto 12B',
    required: false,
  })
  @IsString()
  @IsOptional()
  addressLine2?: string;

  @ApiProperty({
    description: 'District or neighborhood name.',
    example: 'Bela Vista',
  })
  @IsString()
  @IsNotEmpty({ message: 'district is mandatory.' })
  district: string;

  @ApiProperty({
    description: 'City name.',
    example: 'São Paulo',
  })
  @IsString()
  @IsNotEmpty({ message: 'city is mandatory.' })
  city: string;

  @ApiProperty({
    description: 'State or region code (UF in Brazil).',
    example: 'SP',
  })
  @IsString()
  @Length(2, 2, { message: 'region must contain exactly 2 characters.' })
  region: string;

  @ApiProperty({
    description: 'Postal code in Brazilian format.',
    example: '01310-000',
  })
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, {
    message: 'Postal code must follow the pattern 00000-000.',
  })
  postalCode: string;
}
