import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { FixedTimesService } from '@/scheduling/fixed-times/fixedTimes.service';
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateFixedTimeDTO } from './dto/createFixedTime.Dto';
import {
  FixedTimeResponseDTO,
  StudentScheduleResponseDTO,
} from './dto/fixedTimeResponse.Dto';
import { UpdateFixedTimeDTO } from './dto/updateFixedTime.Dto';

@ApiTags('Educator schedule')
@Controller('educator/students/:studentId/schedule')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
export class FixedTimesController {
  constructor(private readonly service: FixedTimesService) {}

  @ApiOperation({ summary: "A student's fixed times and the next 28 days" })
  @ApiResponse({ status: 200, description: 'Schedule listed.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Get()
  async list(
    @Param('studentId') studentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentScheduleResponseDTO> {
    return await this.service.list(req.user.id, studentId);
  }

  @ApiOperation({ summary: 'Add a fixed weekly time' })
  @ApiResponse({ status: 201, description: 'Fixed time created.' })
  @ApiResponse({ status: 400, description: 'Invalid values.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @ApiResponse({
    status: 409,
    description: 'Conflict with another session, or the 14-time limit.',
  })
  @Post('fixed-times')
  async create(
    @Param('studentId') studentId: string,
    @Body() dto: CreateFixedTimeDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<FixedTimeResponseDTO> {
    return await this.service.create(req.user.id, studentId, dto);
  }

  @ApiOperation({ summary: 'Change a fixed time (future sessions only)' })
  @ApiResponse({ status: 200, description: 'Fixed time changed.' })
  @ApiResponse({ status: 400, description: 'Invalid values.' })
  @ApiResponse({ status: 404, description: 'Student or fixed time not found.' })
  @ApiResponse({ status: 409, description: 'Conflict with another session.' })
  @Patch('fixed-times/:id')
  async update(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFixedTimeDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<FixedTimeResponseDTO> {
    return await this.service.update(req.user.id, studentId, id, dto);
  }

  @ApiOperation({
    summary: 'Remove a fixed time and cancel its future sessions',
  })
  @ApiResponse({ status: 204, description: 'Fixed time removed.' })
  @ApiResponse({ status: 404, description: 'Student or fixed time not found.' })
  @Delete('fixed-times/:id')
  @HttpCode(204)
  async remove(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(req.user.id, studentId, id);
  }
}
