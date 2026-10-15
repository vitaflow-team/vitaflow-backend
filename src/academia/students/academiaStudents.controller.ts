import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import {
  Body,
  Controller,
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
import { AcademiaStudentsService } from './academiaStudents.service';
import { AssignEducatorDTO } from './dto/assignEducator.Dto';

@ApiTags('Academia — Students')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/students')
export class AcademiaStudentsController {
  constructor(private readonly students: AcademiaStudentsService) {}

  @ApiOperation({
    summary:
      'Every gym student of this academia (minimal list — see gym-students for the full screen)',
  })
  @Get()
  async list(@Request() req: AcademiaOwnerRequest) {
    return await this.students.list(req.user.academiaId);
  }

  @ApiOperation({
    summary: "Assign, reassign, or clear a gym student's educator",
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Aluno não encontrado nesta academia.',
  })
  @ApiResponse({
    status: 400,
    description:
      'O educador escolhido não está mais empregado por esta academia.',
  })
  @HttpCode(204)
  @Post(':id/assign-educator')
  async assignEducator(
    @Param('id') id: string,
    @Body() dto: AssignEducatorDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.students.assignEducator(
      req.user.academiaId,
      id,
      dto.professionalId,
    );
  }
}
