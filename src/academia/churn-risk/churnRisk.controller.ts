import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
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

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';

@ApiTags('Academia — Risco de evasão')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/churn-risk')
export class ChurnRiskController {
  constructor(
    private readonly churnRisk: ChurnRiskEvaluationService,
    private readonly clients: ClientsRepository,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary:
      'Dismiss a flagged student, closing every currently-open churn-risk episode',
  })
  @HttpCode(200)
  @Post(':clientId/dismiss')
  async dismiss(
    @Param('clientId') clientId: string,
    @Request() req: AcademiaOwnerRequest,
  ) {
    await this.assertOwned(clientId, req.user.academiaId);
    return await this.churnRisk.dismissForClient(clientId, this.clock.now());
  }

  private async assertOwned(
    clientId: string,
    academiaId: string,
  ): Promise<void> {
    const client = await this.clients.getClientById(clientId);
    if (!client || client.academiaId !== academiaId) {
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    }
  }
}
