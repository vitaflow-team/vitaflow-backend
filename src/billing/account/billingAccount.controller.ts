import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BillingAccountService } from './billingAccount.service';
import { ConnectAccountDTO } from './dto/connectAccount.Dto';
import { BillingAccountResponse } from './dto/billingAccountResponse.Dto';

@ApiTags('Billing')
@Controller('billing/account')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
export class BillingAccountController {
  constructor(private readonly service: BillingAccountService) {}

  @ApiOperation({ summary: "The professional's gateway connection and plan" })
  @ApiResponse({ status: 200, type: BillingAccountResponse })
  @Get()
  async get(@Request() req: AuthenticatedRequest) {
    return await this.service.get(req.user.id);
  }

  @ApiOperation({ summary: 'Connect or replace the Asaas account (Premium)' })
  @ApiResponse({ status: 200, type: BillingAccountResponse })
  @ApiResponse({ status: 400, description: 'The key was refused.' })
  @ApiResponse({ status: 403, description: 'Premium plan required.' })
  @ApiResponse({
    status: 409,
    description: 'The key belongs to another account.',
  })
  @ApiResponse({ status: 503, description: 'The gateway is unavailable.' })
  @Put()
  @UseGuards(ProfessionalPremiumGuard)
  async connect(
    @Body() dto: ConnectAccountDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.service.connect(req.user.id, dto.apiKey);
  }

  @ApiOperation({ summary: 'Disconnect the Asaas account and delete its key' })
  @ApiResponse({ status: 204, description: 'Disconnected.' })
  @Delete()
  @HttpCode(204)
  async disconnect(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.service.disconnect(req.user.id);
  }
}
