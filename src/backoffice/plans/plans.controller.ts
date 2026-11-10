import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateProductDTO } from './dto/createProduct.Dto';
import { RepriceProductDTO } from './dto/repriceProduct.Dto';
import { PlansService, ProductCatalogEntry } from './plans.service';

// Guard stack mirrors `BackofficeStaffController`'s per-method style
// (ADR-005): the read route is visible to both backoffice tiers, every
// mutation additionally requires `AdminTierGuard`.
@ApiTags('Backoffice plans')
@Controller('backoffice/plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @ApiOperation({
    summary: 'List the full platform product catalog',
    description:
      'Every Product, every role/tier, active and inactive alike. ' +
      'Visible to EQUIPE and ADMIN.',
  })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard)
  @Get()
  async list(): Promise<ProductCatalogEntry[]> {
    return await this.service.listCatalog();
  }

  @ApiOperation({ summary: 'Create a new platform product' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Post()
  async create(@Body() body: CreateProductDTO): Promise<ProductCatalogEntry> {
    return await this.service.createProduct(body);
  }

  @ApiOperation({
    summary: 'Reprice a product',
    description:
      "Never edits the existing row's price in place (ADR-004): creates a " +
      'new active row (same group/type/tier, new price) and deactivates ' +
      'the original, in one transaction.',
  })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Post(':id/reprice')
  async reprice(
    @Param('id') id: string,
    @Body() body: RepriceProductDTO,
  ): Promise<ProductCatalogEntry> {
    return await this.service.repriceProduct(id, body.price);
  }

  @ApiOperation({ summary: 'Deactivate a product without deleting it' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.deactivateProduct(id);
    return { ok: true };
  }
}
