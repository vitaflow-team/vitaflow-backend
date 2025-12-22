import {
  ProductGroupWithDetails,
  ProductsRepository,
} from '@/repositories/product/product.repository';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsRepository) {}

  @ApiOperation({
    summary: 'Get Products',
    description: 'Get products for the professional.',
  })
  @ApiResponse({
    status: 200,
    description: 'Products successfully retrieved.',
  })
  @Get()
  async getProducts(): Promise<ProductGroupWithDetails[]> {
    const result = await this.products.getAllProducts();

    return result;
  }
}
