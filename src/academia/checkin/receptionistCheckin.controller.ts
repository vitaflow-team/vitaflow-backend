import { ReceptionistAuthGuard } from '@/common/guards/receptionistAuth.guard';
import type { ReceptionistRequest } from '@/common/types/receptionistRequest';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { CodedError } from '@/common/errors/codedError';
import { foldText } from '@/educator-students/students/studentSearch.util';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckInService } from './checkin.service';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';

@ApiTags('Check-in — Recepção')
@ApiBearerAuth('jwt')
@UseGuards(ReceptionistAuthGuard)
@Controller('academia/staff/students')
export class ReceptionistCheckInController {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly checkIns: CheckInService,
  ) {}

  @ApiOperation({ summary: "Search this academia's gym students by name" })
  @Get()
  async search(
    @Query('search') search: string | undefined,
    @Request() req: ReceptionistRequest,
  ) {
    const all = await this.clients.findAllGymStudentNames(req.user.academiaId);
    const term = foldText(search ?? '');
    if (term === '') return all;
    return all.filter((student) => foldText(student.name).includes(term));
  }

  @ApiOperation({ summary: "Register a check-in on a student's behalf" })
  @HttpCode(201)
  @Post(':clientId/checkin')
  async checkIn(
    @Param('clientId') clientId: string,
    @Request() req: ReceptionistRequest,
  ) {
    const client = await this.clients.getClientById(clientId);
    if (!client || client.academiaId !== req.user.academiaId) {
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    }
    return await this.checkIns.register(clientId, 'RECEPTIONIST', req.user.id);
  }
}
