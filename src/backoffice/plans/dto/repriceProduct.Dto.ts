import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class RepriceProductDTO {
  @ApiProperty({
    description:
      'The new price for the versioned replacement row. Never edits the ' +
      "existing product's price in place (ADR-004).",
    example: 39.9,
  })
  @IsNumber()
  price: number;
}
