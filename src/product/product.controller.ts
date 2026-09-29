import {
  ProductGroupWithDetails,
  ProductWithInfos,
} from '@/repositories/product/product.repository';
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductGroupResponseDTO } from './productGroupResponse.Dto';
import { ProductResponseDTO } from './productResponse.Dto';
import { ProductsService } from './product.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @ApiOperation({
    summary: 'Get Products',
    description:
      'Product groups with their plans and feature lists. Gated by the ' +
      'shared application secret.',
  })
  @ApiResponse({
    status: 200,
    description: 'Products successfully retrieved.',
    type: [ProductGroupResponseDTO],
  })
  @ApiResponse({ status: 403, description: 'Missing or wrong secret.' })
  @Get()
  async getProducts(): Promise<ProductGroupWithDetails[]> {
    return await this.service.getProducts();
  }

  @ApiOperation({
    summary: 'Get Product by ID',
    description:
      'One plan with its feature list. The body is empty when no plan has ' +
      'that id. Gated by the shared application secret.',
  })
  @ApiResponse({
    status: 200,
    description: 'Product successfully retrieved.',
    type: ProductResponseDTO,
  })
  @ApiResponse({ status: 403, description: 'Missing or wrong secret.' })
  @Get(':id')
  async getProductById(
    @Param('id') id: string,
  ): Promise<ProductWithInfos | null> {
    return await this.service.getProductById(id);
  }
}
