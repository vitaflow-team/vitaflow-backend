import { AuthGuard } from '@/auth/auth.guard';
import { BillingOwnerGuard } from '@/billing/owner/billingOwner.guard';
import { BillingPlanGuard } from '@/billing/owner/billingPlan.guard';
import { CurrentBillingOwner } from '@/billing/owner/currentBillingOwner.decorator';
import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateInvoiceDTO } from './dto/createInvoice.Dto';
import { InvoiceListResponse } from './dto/invoiceListResponse.Dto';
import { InvoiceResponse } from './dto/invoiceResponse.Dto';
import { SetTaxIdDTO } from './dto/setTaxId.Dto';
import { TaxIdResponse } from './dto/taxIdResponse.Dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Billing')
@Controller('billing/students/:clientId')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, BillingOwnerGuard)
export class StudentInvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @ApiOperation({
    summary: "The student's invoices, financial situation and tax id",
  })
  @ApiResponse({ status: 200, type: InvoiceListResponse })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Get('invoices')
  async list(
    @Param('clientId') clientId: string,
    @Query('page') page: string | undefined,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.list(owner, clientId, Number(page) || 1);
  }

  @ApiOperation({
    summary: 'Generate a new invoice for the student (professionals only)',
  })
  @ApiResponse({ status: 201, type: InvoiceResponse })
  @ApiResponse({ status: 400, description: 'Invalid input or missing tax id.' })
  @ApiResponse({
    status: 403,
    description:
      'manual_invoice_not_allowed (gym owner) or student_billed_by_gym (educator).',
  })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @ApiResponse({
    status: 409,
    description: 'An invoice already exists for that month.',
  })
  @Post('invoices')
  @UseGuards(BillingPlanGuard)
  async create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateInvoiceDTO,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.create(owner, clientId, dto);
  }

  @ApiOperation({
    summary: "Store or replace the student's CPF or CNPJ",
  })
  @ApiResponse({ status: 200, type: TaxIdResponse })
  @ApiResponse({ status: 400, description: 'Invalid CPF or CNPJ.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Put('tax-id')
  @UseGuards(BillingPlanGuard)
  async setTaxId(
    @Param('clientId') clientId: string,
    @Body() dto: SetTaxIdDTO,
    @CurrentBillingOwner() owner: BillingOwner,
  ) {
    return await this.service.setTaxId(owner, clientId, dto.cpfCnpj);
  }
}
