import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
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
import { AcademiaAccessPlanService } from './academiaAccessPlan.service';
import { CreateAccessPlanDTO } from './dto/createAccessPlan.Dto';
import { UpdateAccessPlanDTO } from './dto/updateAccessPlan.Dto';

const PLAN_NOT_FOUND = 'Plano de acesso não encontrado.';

@ApiTags('Academia — Access Plans')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/access-plans')
export class AcademiaAccessPlanController {
  constructor(private readonly plans: AcademiaAccessPlanService) {}

  @ApiOperation({
    summary: "This academia's access-plan catalog, active and historical",
  })
  @Get()
  async list(@Request() req: AcademiaOwnerRequest) {
    return await this.plans.list(req.user.academiaId);
  }

  @ApiOperation({ summary: 'Create an access-plan catalog entry' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Campo inválido.' })
  @Post()
  async create(
    @Body() dto: CreateAccessPlanDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.plans.create(req.user.academiaId, dto);
  }

  @ApiOperation({
    summary: 'Edit a plan — allowed regardless of active/deactivated state',
  })
  @ApiResponse({ status: 404, description: PLAN_NOT_FOUND })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAccessPlanDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    await this.plans.update(req.user.academiaId, id, dto);
  }

  @ApiOperation({
    summary: 'Deactivate a plan — soft, the row is never deleted',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: PLAN_NOT_FOUND })
  @HttpCode(204)
  @Post(':id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.plans.deactivate(req.user.academiaId, id);
  }
}
