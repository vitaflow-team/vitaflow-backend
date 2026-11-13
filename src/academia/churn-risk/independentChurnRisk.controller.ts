import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { CodedError } from '@/common/errors/codedError';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Clock } from '@/scheduling/clock.service';
import {
  Controller,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';

const CLIENT_NOT_FOUND = 'Cliente não encontrado.';

// Separate from ChurnRiskController on purpose (churn-risk-alert-independent
// ADR-006): that controller's class-level AcademiaOwnerGuard would
// incorrectly reject every independent professional, who has no academiaId.
@ApiTags('Churn risk — profissionais independentes')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('professionals/clients')
export class IndependentChurnRiskController {
  constructor(
    private readonly churnRisk: ChurnRiskEvaluationService,
    private readonly clients: ClientsRepository,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary:
      'Dismiss a flagged private client, closing every currently-open churn-risk episode',
  })
  @HttpCode(200)
  @Post(':clientId/churn-risk/dismiss')
  async dismiss(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.assertOwned(clientId, req.user.id);
    return await this.churnRisk.dismissForClient(clientId, this.clock.now());
  }

  // A gym-owned client (academiaId set) is never dismissible here, even if
  // professionalId happens to match the caller (an assigned educator) — US-
  // 006.EC-2.
  private async assertOwned(
    clientId: string,
    professionalId: string,
  ): Promise<void> {
    const client = await this.clients.getClientById(clientId);
    if (
      !client ||
      client.professionalId !== professionalId ||
      client.academiaId !== null
    ) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }
  }
}
