import { AuthGuard } from '@/auth/auth.guard';
import { GymStudentGuard } from '@/common/guards/gymStudent.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TurmaEnrollmentService } from './turmaEnrollment.service';

@ApiTags('Turmas — Aluno')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, GymStudentGuard)
@Controller('turmas')
export class StudentTurmasController {
  constructor(private readonly enrollments: TurmaEnrollmentService) {}

  @ApiOperation({
    summary:
      'Every eligible turma across every academia this student has a Client row at',
  })
  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return await this.enrollments.listForStudent(req.user.id);
  }

  @ApiOperation({ summary: 'Self-service enrollment' })
  @HttpCode(201)
  @Post(':id/enroll')
  async enroll(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.enrollments.enrollSelf(req.user.id, id);
  }

  @ApiOperation({ summary: 'Self-cancellation' })
  @HttpCode(204)
  @Delete(':id/enroll')
  async cancel(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.enrollments.cancelSelf(req.user.id, id);
  }
}
