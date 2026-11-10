import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateServicePackageDTO {
  @ApiProperty({ example: 'Pacote mensal de consultas' })
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank.' })
  name: string;

  @ApiProperty({
    example: 4,
    description: 'Number of sessions/consultations included.',
  })
  @IsInt()
  @IsPositive()
  sessionCount: number;

  @ApiProperty({
    example: 399.9,
    description:
      "Reference price for the professional's own bookkeeping only — informational, never billed by VitaFlow (ADR-003).",
  })
  @IsNumber()
  @Min(0)
  referencePrice: number;
}
