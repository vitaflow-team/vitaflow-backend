import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { Clock } from '@/scheduling/clock.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { CodedError } from '@/common/errors/codedError';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssignAccessPlanDTO } from './dto/assignAccessPlan.Dto';
import { StudentAccessPlanService } from './studentAccessPlan.service';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';

@ApiTags('Academia — Planos de acesso do aluno')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/students/:id/access-plan')
export class StudentAccessPlanController {
  constructor(
    private readonly accessPlans: StudentAccessPlanService,
    private readonly clients: ClientsRepository,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary: "Assign or replace this student's active access plan",
  })
  @Post()
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignAccessPlanDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    await this.assertOwned(id, req.user.academiaId);
    return await this.accessPlans.assign(id, dto.accessPlanId);
  }

  @ApiOperation({
    summary: "This student's current plan and computed remaining validity",
  })
  @Get()
  async current(@Param('id') id: string, @Request() req: AcademiaOwnerRequest) {
    await this.assertOwned(id, req.user.academiaId);
    return await this.accessPlans.currentForClient(id, this.clock.now());
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
