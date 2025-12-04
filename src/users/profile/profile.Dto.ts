import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
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

  @ApiProperty({ type: ProfileAddressDTO })
  @ValidateNested()
  @Type(() => ProfileAddressDTO)
  address: ProfileAddressDTO;
}
