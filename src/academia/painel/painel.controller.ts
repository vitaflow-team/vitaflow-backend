import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PainelResponse, PainelService } from './painel.service';

@ApiTags('Academia — Painel')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/painel')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @ApiOperation({
    summary: 'Counts, active-educator list and recent activity feed (US-017)',
  })
  @Get()
  async get(@Request() req: AcademiaOwnerRequest): Promise<PainelResponse> {
    return await this.painel.getPainel(req.user.academiaId, req.user.id);
  }
}
