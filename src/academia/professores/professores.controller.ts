import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListProfessoresQueryDTO } from './dto/listProfessores.Dto';
import { ProfessoresService } from './professores.service';

@ApiTags('Academia — Professores')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/professores')
export class ProfessoresController {
  constructor(private readonly professores: ProfessoresService) {}

  @ApiOperation({
    summary:
      'Merged, searched, paginated list of active educators and pending employment invitations (US-001, US-002, US-006)',
  })
  @Get()
  async list(
    @Query() query: ListProfessoresQueryDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.professores.list({
      academiaId: req.user.academiaId,
      search: query.search,
      page: query.page ?? 1,
    });
  }
}
