import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { ProductInfoResponseDTO } from './productInfoResponse.Dto';

// A plan with its feature list. Decorated for Swagger, never validated.
export class ProductResponseDTO {
  @ApiProperty({ example: 'cuid-product-123' })
  id: string;

  @ApiProperty({ example: 'Premium' })
  name: string;

  @ApiProperty({ example: 29.9 })
  price: number;

  @ApiProperty({ example: 'cuid-group-123' })
  groupId: string;

  @ApiProperty({ enum: ProductType })
  type: ProductType;

  @ApiProperty({ nullable: true, type: String, example: 'price_123' })
  stripeId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [ProductInfoResponseDTO] })
  productInfos: ProductInfoResponseDTO[];
}
