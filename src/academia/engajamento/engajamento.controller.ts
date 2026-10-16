import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { Clock } from '@/scheduling/clock.service';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EngajamentoService } from './engajamento.service';

@ApiTags('Academia — Engajamento')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/engajamento')
export class EngajamentoController {
  constructor(
    private readonly engajamento: EngajamentoService,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary: "Today's count, weekly frequency, risk list, and recent feed",
  })
  @Get()
  async summary(@Request() req: AcademiaOwnerRequest) {
    return await this.engajamento.summary(
      req.user.academiaId,
      this.clock.now(),
    );
  }
}
