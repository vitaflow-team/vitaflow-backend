import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class ProfileAddressDTO {
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
