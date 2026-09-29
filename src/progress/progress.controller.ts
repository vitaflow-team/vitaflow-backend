import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DEFAULT_DASHBOARD_WEEKS } from './dashboardWeeks';
import { CreateMeasurementRecordDTO } from './dto/createMeasurementRecord.Dto';
import { DashboardQueryDTO } from './dto/dashboardQuery.Dto';
import { DashboardResponseDTO } from './dto/dashboardResponse.Dto';
import { LatestRecordResponseDTO } from './dto/latestRecordResponse.Dto';
import { MeasurementRecordResponseDTO } from './dto/measurementRecordResponse.Dto';
import { UpdateMeasurementRecordDTO } from './dto/updateMeasurementRecord.Dto';
import { ProgressService } from './progress.service';

@ApiTags('Progress records')
@Controller('progress-records')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly service: ProgressService) {}

  @ApiOperation({ summary: 'Get the authenticated user progress dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard successfully retrieved.',
    type: DashboardResponseDTO,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 400, description: 'Invalid dashboard period.' })
  @ApiQuery({
    name: 'weeks',
    required: false,
    enum: [4, 8, 12],
    description: 'Dashboard chart period in weeks. Defaults to 8.',
  })
  @Get('dashboard')
  async getDashboard(
    @Request() req: AuthenticatedRequest,
    @Query() query: DashboardQueryDTO,
  ): Promise<DashboardResponseDTO> {
    return await this.service.getDashboard(
      req.user.id,
      query.weeks ?? DEFAULT_DASHBOARD_WEEKS,
    );
  }

  @ApiOperation({
    summary: 'Get the latest measurement record of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description:
      'Latest measurement record, or { latest: null } when the user has none.',
    type: LatestRecordResponseDTO,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Get('latest')
  async getLatest(
    @Request() req: AuthenticatedRequest,
  ): Promise<LatestRecordResponseDTO> {
    return await this.service.getLatest(req.user.id);
  }

  @ApiOperation({ summary: 'Create a measurement record' })
  @ApiBody({ type: CreateMeasurementRecordDTO })
  @ApiResponse({
    status: 201,
    description: 'Measurement record created.',
    type: MeasurementRecordResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid measurement values.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    return await this.service.create(req.user.id, body);
  }

  @ApiOperation({ summary: 'Update an owned measurement record' })
  @ApiBody({ type: UpdateMeasurementRecordDTO })
  @ApiResponse({
    status: 200,
    description: 'Measurement record updated.',
    type: MeasurementRecordResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid measurement values.' })
  @ApiResponse({ status: 401, description: 'Action not permitted.' })
  @ApiResponse({ status: 404, description: 'Measurement record not found.' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: UpdateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    return await this.service.update(id, req.user.id, body);
  }

  @ApiOperation({ summary: 'Delete an owned measurement record' })
  @ApiResponse({ status: 204, description: 'Measurement record deleted.' })
  @ApiResponse({ status: 401, description: 'Action not permitted.' })
  @ApiResponse({ status: 404, description: 'Measurement record not found.' })
  @HttpCode(204)
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return await this.service.delete(id, req.user.id);
  }
}
