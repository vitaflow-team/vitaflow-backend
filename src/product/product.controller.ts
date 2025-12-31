import { ProductGroupWithDetails } from '@/repositories/product/product.repository';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './product.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

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
    return await this.service.getProducts();
  }
}
