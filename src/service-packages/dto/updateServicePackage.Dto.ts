import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class UpdateServicePackageDTO {
  @ApiProperty({ required: false, example: 'Pacote mensal de consultas' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name?: string;

  @ApiProperty({ required: false, example: 4 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  sessionCount?: number;

  @ApiProperty({ required: false, example: 399.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  referencePrice?: number;
}
