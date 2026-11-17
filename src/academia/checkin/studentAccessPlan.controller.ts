import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { Clock } from '@/scheduling/clock.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { CodedError } from '@/common/errors/codedError';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { AccessPlanLinkService } from '../billing/accessPlanLink.service';
import { gymOwnerOf } from '../billing/gymOwner';
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
    private readonly links: AccessPlanLinkService,
    private readonly clients: ClientsRepository,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary:
      "Assign or replace this student's active access plan, optionally starting the monthly billing",
  })
  @ApiResponse({
    status: 201,
    description:
      '{ plan, billing, firstInvoice }; the last two are null when no billing was started.',
  })
  @ApiResponse({
    status: 400,
    description: 'invalid_due_day, invalid_amount or tax_id_required.',
  })
  @ApiResponse({
    status: 404,
    description: 'student_not_found or access_plan_not_found.',
  })
  @ApiResponse({
    status: 409,
    description:
      'recurring_billing_exists, billing_not_connected or billing_reconnect_needed.',
  })
  @Post()
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignAccessPlanDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    await this.assertOwned(id, req.user.academiaId);
    return await this.links.assign({
      owner: gymOwnerOf(req),
      clientId: id,
      accessPlanId: dto.accessPlanId,
      billing: dto.billing,
    });
  }

  @ApiOperation({
    summary:
      'Unlink the student: archive the plan, end the monthly billing and cancel the open fees due today or later',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'student_not_found or student_has_no_plan.',
  })
  @HttpCode(204)
  @Delete()
  async unlink(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.links.unlink({ owner: gymOwnerOf(req), clientId: id });
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
