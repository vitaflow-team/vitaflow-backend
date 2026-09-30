import { AuthGuard } from '@/auth/auth.guard';
import type { BackofficeAwareRequest } from '@/common/types/backofficeAwareRequest';
import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ExerciseEquipment } from '@prisma/client';
import { ExerciseFilterDto } from './dto/exerciseFilter.Dto';
import { ExerciseEntity } from './exercise.entity';
import { ExerciseLibraryService } from './exerciseLibrary.service';

@ApiTags('Exercise library')
@Controller('exercises')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ExercisesController {
  constructor(private readonly service: ExerciseLibraryService) {}

  @ApiOperation({
    summary: 'List exercises',
    description:
      'Lists approved exercises only, filtered by muscle group, equipment and name, 50 per page.',
  })
  @ApiQuery({ name: 'muscleGroup', required: false, example: 'Peito' })
  @ApiQuery({ name: 'equipment', required: false, enum: ExerciseEquipment })
  @ApiQuery({ name: 'q', required: false, example: 'supino' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Exercises successfully retrieved.',
    type: [ExerciseEntity],
  })
  @ApiResponse({ status: 400, description: 'Invalid filter values.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Get()
  async findMany(@Query() query: ExerciseFilterDto): Promise<ExerciseEntity[]> {
    return await this.service.findMany(query);
  }

  @ApiOperation({
    summary: 'Get an exercise by ID',
    description:
      'Returns an approved exercise. Backoffice staff can also read pending or rejected ones.',
  })
  @ApiResponse({
    status: 200,
    description: 'Exercise successfully retrieved.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 404, description: 'Exercise not found.' })
  @Get(':id')
  async findById(
    @Param('id') id: string,
    @Request() req: BackofficeAwareRequest,
  ): Promise<ExerciseEntity> {
    return await this.service.findById(id, req.user.isBackoffice === true);
  }
}
