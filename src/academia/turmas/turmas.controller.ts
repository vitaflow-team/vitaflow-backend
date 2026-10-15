import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssignTurmaEducatorDTO } from './dto/assignTurmaEducator.Dto';
import { CreateTurmaDTO } from './dto/createTurma.Dto';
import { ManualEnrollTurmaDTO } from './dto/manualEnrollTurma.Dto';
import { UpdateTurmaDTO } from './dto/updateTurma.Dto';
import { TurmaEnrollmentService } from './turmaEnrollment.service';
import { TurmasService } from './turmas.service';

@ApiTags('Academia — Turmas')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/turmas')
export class TurmasController {
  constructor(
    private readonly turmas: TurmasService,
    private readonly enrollments: TurmaEnrollmentService,
  ) {}

  @ApiOperation({
    summary: 'Weekly agenda: every live turma with its enrollment count',
  })
  @Get()
  async weeklyAgenda(@Request() req: AcademiaOwnerRequest) {
    return await this.turmas.weeklyAgenda(req.user.academiaId);
  }

  @ApiOperation({ summary: 'Create a turma' })
  @Post()
  async create(
    @Body() dto: CreateTurmaDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.turmas.create({
      academiaId: req.user.academiaId,
      ...dto,
    });
  }

  @ApiOperation({
    summary: 'Edit name/weekday/startMinute/durationMinutes/capacity',
  })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTurmaDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.turmas.update(id, req.user.academiaId, dto);
  }

  @ApiOperation({
    summary: 'Assign, reassign, or clear the responsible educator',
  })
  @Post(':id/assign-educator')
  async assignEducator(
    @Param('id') id: string,
    @Body() dto: AssignTurmaEducatorDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.turmas.assignEducator(
      id,
      req.user.academiaId,
      dto.professionalId,
    );
  }

  @ApiOperation({ summary: 'Remove a turma (soft-delete)' })
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.turmas.remove(id, req.user.academiaId);
  }

  @ApiOperation({ summary: 'Manually enroll a gym student of this academia' })
  @HttpCode(201)
  @Post(':id/enrollments')
  async enrollManual(
    @Param('id') id: string,
    @Body() dto: ManualEnrollTurmaDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.enrollments.enrollManual(req.user.academiaId, id, dto.clientId);
  }
}
