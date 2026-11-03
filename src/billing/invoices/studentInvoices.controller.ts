import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
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
@UseGuards(AuthGuard, ProfessionalGuard)
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
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.list(req.user.id, clientId, Number(page) || 1);
  }

  @ApiOperation({ summary: 'Generate a new invoice for the student (Premium)' })
  @ApiResponse({ status: 201, type: InvoiceResponse })
  @ApiResponse({ status: 400, description: 'Invalid input or missing tax id.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @ApiResponse({
    status: 409,
    description: 'An invoice already exists for that month.',
  })
  @Post('invoices')
  @UseGuards(ProfessionalPremiumGuard)
  async create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateInvoiceDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.create(req.user.id, clientId, dto);
  }

  @ApiOperation({
    summary: "Store or replace the student's CPF or CNPJ (Premium)",
  })
  @ApiResponse({ status: 200, type: TaxIdResponse })
  @ApiResponse({ status: 400, description: 'Invalid CPF or CNPJ.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Put('tax-id')
  @UseGuards(ProfessionalPremiumGuard)
  async setTaxId(
    @Param('clientId') clientId: string,
    @Body() dto: SetTaxIdDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.setTaxId(req.user.id, clientId, dto.cpfCnpj);
  }
}
