import { ApiProperty } from '@nestjs/swagger';

export class ProductInfoResponseDTO {
  @ApiProperty({ example: 'cuid-info-123' })
  id: string;

  @ApiProperty({ example: 'Acompanhamento de medidas' })
  description: string;

  @ApiProperty({ example: 'cuid-product-123' })
  productId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
