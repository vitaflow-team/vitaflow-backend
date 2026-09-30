import { AuthGuard } from '@/auth/auth.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
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
import { ExerciseStatus } from '@prisma/client';
import { ExerciseCreateDto } from './dto/exerciseCreate.Dto';
import { ExerciseFilterDto } from './dto/exerciseFilter.Dto';
import { ExerciseRejectDto } from './dto/exerciseReject.Dto';
import { ExerciseUpdateDto } from './dto/exerciseUpdate.Dto';
import { ExerciseEntity } from './exercise.entity';
import { ExerciseLibraryService } from './exerciseLibrary.service';

@ApiTags('Exercise library backoffice')
@Controller('admin/exercises')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, BackofficeGuard)
export class ExerciseAdminController {
  constructor(private readonly service: ExerciseLibraryService) {}

  @ApiOperation({
    summary: 'List pending submissions',
    description: 'The moderation queue: every PENDING educator submission.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Pending submissions successfully retrieved.',
    type: [ExerciseEntity],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @Get('pending')
  async listPending(
    @Query() query: ExerciseFilterDto,
  ): Promise<ExerciseEntity[]> {
    return await this.service.findMany(query, ExerciseStatus.PENDING);
  }

  @ApiOperation({
    summary: 'Approve a pending submission',
    description: 'Moves a PENDING exercise to APPROVED, making it public.',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission approved.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @ApiResponse({ status: 404, description: 'Exercise not found.' })
  @ApiResponse({
    status: 409,
    description: 'The exercise was already approved or rejected.',
  })
  @HttpCode(200)
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExerciseEntity> {
    return await this.service.approve(id, req.user.id);
  }

  @ApiOperation({
    summary: 'Reject a pending submission',
    description:
      'Moves a PENDING exercise to REJECTED, with an optional reason for the educator.',
  })
  @ApiBody({ type: ExerciseRejectDto })
  @ApiResponse({
    status: 200,
    description: 'Submission rejected.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 400, description: 'Invalid rejection reason.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @ApiResponse({ status: 404, description: 'Exercise not found.' })
  @ApiResponse({
    status: 409,
    description: 'The exercise was already approved or rejected.',
  })
  @HttpCode(200)
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: ExerciseRejectDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExerciseEntity> {
    return await this.service.reject(id, req.user.id, body.reason);
  }

  @ApiOperation({
    summary: 'Create an exercise directly',
    description:
      'Backoffice edits are trusted: the exercise is APPROVED at once.',
  })
  @ApiBody({ type: ExerciseCreateDto })
  @ApiResponse({
    status: 201,
    description: 'Exercise created and published.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 400, description: 'Invalid exercise data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @Post()
  async create(
    @Body() body: ExerciseCreateDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExerciseEntity> {
    return await this.service.createDirect(body, req.user.id);
  }

  @ApiOperation({
    summary: 'Edit an exercise directly',
    description:
      'Updates any field, including equipment and contraindications. No review step.',
  })
  @ApiBody({ type: ExerciseUpdateDto })
  @ApiResponse({
    status: 200,
    description: 'Exercise updated.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 400, description: 'Invalid exercise data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @ApiResponse({ status: 404, description: 'Exercise not found.' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: ExerciseUpdateDto,
  ): Promise<ExerciseEntity> {
    return await this.service.update(id, body);
  }

  @ApiOperation({ summary: 'Remove an exercise from the catalog' })
  @ApiResponse({ status: 204, description: 'Exercise removed. No body.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Caller is not backoffice staff.' })
  @ApiResponse({ status: 404, description: 'Exercise not found.' })
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
