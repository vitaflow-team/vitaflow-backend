import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { PlatformDelinquentsResponseDTO } from './dto/platformDelinquentsResponse.Dto';
import type { PlatformSummaryResponseDTO } from './dto/platformSummaryResponse.Dto';
import { PlatformFinancialService } from './platformFinancial.service';
import type { BackofficeRequest } from './types/backofficeRequest';

@ApiTags('Backoffice financial health')
@ApiBearerAuth('jwt')
@Controller('backoffice/financial-health')
@UseGuards(AuthGuard, BackofficeGuard)
export class PlatformFinancialController {
  constructor(private readonly service: PlatformFinancialService) {}

  @ApiOperation({
    summary:
      "Expected, received and still owed of Vitaflow's own subscriptions for a month, by account type, plus today's overdue bands, admin-interno-only",
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'YYYY-MM, the current month or one of the 12 before it.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Month figures (null with available=false before the first stored payment), previous month (null without a base), overdue bands and syncedAt.',
  })
  @ApiResponse({ status: 400, description: 'invalid_month.' })
  @ApiResponse({
    status: 403,
    description: 'not_backoffice or not_admin_interno.',
  })
  @UseGuards(AdminTierGuard)
  @Get('summary')
  async summary(
    @Query('month') month: string | undefined,
  ): Promise<PlatformSummaryResponseDTO> {
    return await this.service.summary(month);
  }

  @ApiOperation({
    summary:
      'A page of the delinquent subscribers with the caller tier and the user count per aging band; every call is recorded in the access log',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based; invalid values are page 1, past the end the last.',
  })
  @ApiResponse({
    status: 200,
    description: 'Up to 20 delinquent users, worst first.',
  })
  @ApiResponse({ status: 403, description: 'not_backoffice.' })
  @ApiResponse({
    status: 503,
    description: 'access_log_failed: nothing is returned.',
  })
  @Get('delinquents')
  async delinquents(
    @Query('page') page: string | undefined,
    @Request() req: BackofficeRequest,
  ): Promise<PlatformDelinquentsResponseDTO> {
    return await this.service.delinquents(req.user, page);
  }
}
