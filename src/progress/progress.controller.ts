import { AuthGuard } from '@/auth/auth.guard';
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
import {
  CreateMeasurementRecordDTO,
  DashboardQueryDTO,
  DEFAULT_DASHBOARD_WEEKS,
  UpdateMeasurementRecordDTO,
} from './progress.Dto';
import { ProgressService } from './progress.service';

type AuthenticatedRequest = { user: { id: string } };

@ApiTags('Progress records')
@Controller('progress-records')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private service: ProgressService) {}

  @ApiOperation({ summary: 'Get the authenticated user progress dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard successfully retrieved.',
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
  ) {
    return await this.service.getDashboard(
      req.user.id,
      query.weeks ?? DEFAULT_DASHBOARD_WEEKS,
    );
  }

  @ApiOperation({ summary: 'Create a measurement record' })
  @ApiBody({ type: CreateMeasurementRecordDTO })
  @ApiResponse({ status: 201, description: 'Measurement record created.' })
  @ApiResponse({ status: 400, description: 'Invalid measurement values.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateMeasurementRecordDTO,
  ) {
    return await this.service.create(req.user.id, body);
  }

  @ApiOperation({ summary: 'Update an owned measurement record' })
  @ApiBody({ type: UpdateMeasurementRecordDTO })
  @ApiResponse({ status: 200, description: 'Measurement record updated.' })
  @ApiResponse({ status: 400, description: 'Invalid measurement values.' })
  @ApiResponse({ status: 401, description: 'Action not permitted.' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: UpdateMeasurementRecordDTO,
  ) {
    return await this.service.update(id, req.user.id, body);
  }

  @ApiOperation({ summary: 'Delete an owned measurement record' })
  @ApiResponse({ status: 204, description: 'Measurement record deleted.' })
  @ApiResponse({ status: 401, description: 'Action not permitted.' })
  @HttpCode(204)
  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return await this.service.delete(id, req.user.id);
  }
}
