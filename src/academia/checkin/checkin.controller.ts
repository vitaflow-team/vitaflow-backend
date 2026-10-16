import { AuthGuard } from '@/auth/auth.guard';
import { GymStudentGuard } from '@/common/guards/gymStudent.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { CodedError } from '@/common/errors/codedError';
import {
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckInService } from './checkin.service';

const NOT_ELIGIBLE = 'Você não tem um vínculo com nenhuma academia.';

@ApiTags('Check-in — Aluno')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, GymStudentGuard)
@Controller('checkins')
export class CheckInController {
  constructor(
    private readonly checkIns: CheckInService,
    private readonly clients: ClientsRepository,
  ) {}

  @ApiOperation({
    summary:
      'Whether this user has an eligible academia-owned Client row at all (US-001.EC-1)',
  })
  @Get('eligibility')
  async eligibility(@Request() req: AuthenticatedRequest) {
    const owned = await this.clients.findAcademiaOwnedByUserId(req.user.id);
    return { eligible: owned.length > 0 };
  }

  @ApiOperation({
    summary: 'Self-service check-in at the academia the student belongs to',
  })
  @HttpCode(201)
  @Post()
  async register(@Request() req: AuthenticatedRequest) {
    const owned = await this.clients.findAcademiaOwnedByUserId(req.user.id);
    const client = owned[0];
    if (!client) {
      throw new CodedError(NOT_ELIGIBLE, 403, 'not_eligible');
    }
    return await this.checkIns.register(client.id, 'SELF');
  }
}
