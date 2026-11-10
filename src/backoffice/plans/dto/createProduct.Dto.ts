import { ApiProperty } from '@nestjs/swagger';
import { ProductTier, ProductType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateProductDTO {
  @ApiProperty({
    description: 'The ProductGroup this new plan belongs to.',
    example: 'group-id',
  })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({ description: 'Plan name.', example: 'Premium' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Price in BRL. Must be greater than zero.' })
  @IsNumber()
  price: number;

  @ApiProperty({ enum: ProductType, example: ProductType.USER })
  @IsEnum(ProductType)
  type: ProductType;

  @ApiProperty({ enum: ProductTier, example: ProductTier.STANDARD })
  @IsEnum(ProductTier)
  tier: ProductTier;
}
