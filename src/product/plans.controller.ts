import { ProductWithInfos } from '@/repositories/product/product.repository';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PLAN_CATEGORIES } from './planCategory';
import { PlansQueryDTO } from './plans.Dto';
import { ProductResponseDTO } from './productResponse.Dto';
import { ProductsService } from './product.service';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly service: ProductsService) {}

  @ApiOperation({
    summary: 'List plans',
    description:
      'Flat plan catalog ordered by price ascending (name breaks ties), ' +
      'optionally filtered by category. Gated by the shared application ' +
      'secret like GET /products. A category with no plans returns [].',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: PLAN_CATEGORIES,
    description: 'Exact category name; anything else is a validation error.',
  })
  @ApiResponse({
    status: 200,
    description: 'Plans successfully retrieved.',
    type: [ProductResponseDTO],
  })
  @ApiResponse({ status: 400, description: 'Invalid category.' })
  @ApiResponse({ status: 403, description: 'Missing or wrong secret.' })
  @Get()
  async getPlans(@Query() query: PlansQueryDTO): Promise<ProductWithInfos[]> {
    return await this.service.listPlans(query.category);
  }
}
