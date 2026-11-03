import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
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
@UseGuards(AuthGuard, ProfessionalGuard, ProfessionalPremiumGuard)
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
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.update(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Cancel an open invoice' })
  @ApiResponse({ status: 200, type: InvoiceResponse })
  @ApiResponse({ status: 404, description: 'Invoice not found.' })
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return await this.service.cancel(req.user.id, id);
  }

  @ApiOperation({ summary: 'Record a payment received outside the gateway' })
  @ApiResponse({ status: 200, type: InvoiceResponse })
  @ApiResponse({ status: 404, description: 'Invoice not found.' })
  @Post(':id/mark-paid')
  @HttpCode(200)
  async markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.markPaid(req.user.id, id, dto);
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
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.resend(req.user.id, id);
  }
}
