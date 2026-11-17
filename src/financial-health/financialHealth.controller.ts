import { AuthGuard } from '@/auth/auth.guard';
import { BillingOwnerGuard } from '@/billing/owner/billingOwner.guard';
import { CurrentBillingOwner } from '@/billing/owner/currentBillingOwner.decorator';
import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { DelinquentsResponseDTO } from './dto/delinquentsResponse.Dto';
import type { FinancialSummaryResponseDTO } from './dto/financialSummaryResponse.Dto';
import { FinancialHealthService } from './financialHealth.service';

@ApiTags('Financial health')
@Controller('financial-health')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, BillingOwnerGuard)
export class FinancialHealthController {
  constructor(private readonly service: FinancialHealthService) {}

  @ApiOperation({
    summary:
      'Expected, received and still owed for a month, plus the overdue bands',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'YYYY-MM, the current month or one of the 12 before it.',
  })
  @ApiResponse({
    status: 200,
    description: 'Month totals, previous month totals and overdue bands.',
  })
  @ApiResponse({ status: 400, description: 'invalid_month.' })
  @ApiResponse({ status: 403, description: 'not_billing_owner.' })
  @ApiResponse({ status: 503, description: 'financial_data_unavailable.' })
  @Get('summary')
  async summary(
    @Query('month') month: string | undefined,
    @CurrentBillingOwner() owner: BillingOwner,
  ): Promise<FinancialSummaryResponseDTO> {
    return await this.service.summary(owner, month);
  }

  @ApiOperation({ summary: 'A page of the people with overdue invoices' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based; invalid values are page 1, past the end the last.',
  })
  @ApiResponse({
    status: 200,
    description: 'Up to 20 delinquent people, worst first.',
  })
  @ApiResponse({ status: 403, description: 'not_billing_owner.' })
  @ApiResponse({ status: 503, description: 'financial_data_unavailable.' })
  @Get('delinquents')
  async delinquents(
    @Query('page') page: string | undefined,
    @CurrentBillingOwner() owner: BillingOwner,
  ): Promise<DelinquentsResponseDTO> {
    return await this.service.delinquents(owner, page);
  }
}
