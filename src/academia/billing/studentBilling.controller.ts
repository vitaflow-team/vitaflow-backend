import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import {
  Body,
  Controller,
  Get,
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
import { ActivateBillingDTO } from './dto/activateBilling.Dto';
import type { ActivationResultResponseDTO } from './dto/activationResultResponse.Dto';
import { ChangeBillingDTO } from './dto/changeBilling.Dto';
import type { EligibleStudentResponseDTO } from './dto/eligibleStudentResponse.Dto';
import type { RecurringBillingResponseDTO } from './dto/recurringBillingResponse.Dto';
import { GymBillingActivationService } from './gymBillingActivation.service';
import { gymOwnerOf } from './gymOwner';
import { GymRecurringBillingService } from './gymRecurringBilling.service';

// `billing/eligible` and `billing/activate` are literal paths, so they never
// collide with the `:id/...` routes of the other students controllers.
@ApiTags('Academia — Cobrança recorrente dos alunos')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/students')
export class StudentBillingController {
  constructor(
    private readonly billing: GymRecurringBillingService,
    private readonly activation: GymBillingActivationService,
  ) {}

  @ApiOperation({
    summary:
      "Change the student's due day and/or fee amount, for fees not yet issued",
  })
  @ApiResponse({ status: 200, description: 'The updated recurring billing.' })
  @ApiResponse({
    status: 400,
    description: 'invalid_due_day or invalid_amount.',
  })
  @ApiResponse({
    status: 404,
    description: 'student_not_found or recurring_billing_not_found.',
  })
  @Patch(':id/billing')
  async change(
    @Param('id') id: string,
    @Body() dto: ChangeBillingDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<RecurringBillingResponseDTO> {
    return await this.billing.changeTerms({
      owner: gymOwnerOf(req),
      clientId: id,
      dueDay: dto.dueDay,
      amountCents: dto.amountCents,
    });
  }

  @ApiOperation({
    summary:
      'Students with an active plan and no recurring billing, with whether a tax ID is on file',
  })
  @ApiResponse({
    status: 200,
    description: 'The students that can be activated.',
  })
  @Get('billing/eligible')
  async eligible(
    @Request() req: AcademiaOwnerRequest,
  ): Promise<EligibleStudentResponseDTO[]> {
    return await this.activation.eligibleForActivation(req.user.academiaId);
  }

  @ApiOperation({
    summary:
      'Start the recurring billing of up to 200 already-linked students, issuing each first fee',
  })
  @ApiResponse({
    status: 200,
    description: '{ activated, skipped } with the reason for each skip.',
  })
  @ApiResponse({
    status: 400,
    description:
      'empty_selection, selection_too_large, invalid_due_day or invalid_amount.',
  })
  @ApiResponse({
    status: 409,
    description: 'billing_not_connected or billing_reconnect_needed.',
  })
  @HttpCode(200)
  @Post('billing/activate')
  async activate(
    @Body() dto: ActivateBillingDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<ActivationResultResponseDTO> {
    return await this.activation.activateMany({
      owner: gymOwnerOf(req),
      items: dto.items,
    });
  }
}
