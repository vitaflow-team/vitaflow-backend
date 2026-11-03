import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChangePlanDTO {
  @ApiProperty({
    description:
      'Vita Flow product id the authenticated user wants to move to.',
    example: 'cuid-product-456',
  })
  @IsString()
  @IsNotEmpty({ message: 'productId is mandatory.' })
  productId: string;
}
