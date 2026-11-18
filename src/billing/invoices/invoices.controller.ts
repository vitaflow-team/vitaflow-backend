import { AuthGuard } from '@/auth/auth.guard';
import { BillingOwnerGuard } from '@/billing/owner/billingOwner.guard';
import { BillingPlanGuard } from '@/billing/owner/billingPlan.guard';
import { CurrentBillingOwner } from '@/billing/owner/currentBillingOwner.decorator';
import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateInvoiceDTO } from './dto/updateInvoice.Dto';
import { MarkPaidDTO } from './dto/markPaid.Dto';
import { InvoiceResponse } from './dto/invoiceResponse.Dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Billing')
@Controller('billing/invoices')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, BillingOwnerGuard, BillingPlanGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @ApiOperation({ summary: 'Edit the amount or due date of an open invoice' })
  @ApiResponse({ status: 200, type: InvoiceResponse })
  @ApiResponse({ status: 404, description: 'Invoice not found.' })
  @ApiResponse({
    status: 409,
    description: 'Not open, or already paid at the gateway.',
  })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDTO,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.update(owner, id, dto);
  }

  @ApiOperation({ summary: 'Cancel an open invoice' })
  @ApiResponse({ status: 200, type: InvoiceResponse })
  @ApiResponse({ status: 404, description: 'Invoice not found.' })
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.cancel(owner, id);
  }

  @ApiOperation({ summary: 'Record a payment received outside the gateway' })
  @ApiResponse({ status: 200, type: InvoiceResponse })
  @ApiResponse({ status: 404, description: 'Invoice not found.' })
  @Post(':id/mark-paid')
  @HttpCode(200)
  async markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDTO,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.markPaid(owner, id, dto);
  }

  @ApiOperation({ summary: 'Resend the payment link e-mail' })
  @ApiResponse({ status: 204, description: 'Resent.' })
  @ApiResponse({
    status: 429,
    description: 'Already resent in the last hour.',
  })
  @Post(':id/resend')
  @HttpCode(204)
  async resend(
    @Param('id') id: string,
    @CurrentBillingOwner() owner: BillingOwner,
  ): Promise<void> {
    await this.service.resend(owner, id);
  }
}
