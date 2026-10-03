import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConflictsRequestDTO } from './dto/conflictsRequest.Dto';
import { CreateWorkoutDTO } from './dto/createWorkout.Dto';
import { DuplicateWorkoutDTO } from './dto/duplicateWorkout.Dto';
import { ListWorkoutsQueryDTO } from './dto/listWorkoutsQuery.Dto';
import { SaveWorkoutDTO } from './dto/saveWorkout.Dto';
import {
  ConflictsResponseDTO,
  DuplicateResponseDTO,
  WorkoutListResponseDTO,
  WorkoutTreeResponseDTO,
} from './dto/workoutResponse.Dto';
import { EducatorWorkoutsService } from './workouts.service';

@ApiTags('Educator workouts')
@Controller('educator/students/:studentId/workouts')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
export class WorkoutsController {
  constructor(private readonly service: EducatorWorkoutsService) {}

  @ApiOperation({ summary: "A student's workouts: active, drafts, archived" })
  @ApiResponse({ status: 200, description: 'Workouts listed.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Get()
  async list(
    @Param('studentId') studentId: string,
    @Query() query: ListWorkoutsQueryDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutListResponseDTO> {
    return await this.service.list(req.user.id, studentId, query.archivedPage);
  }

  @ApiOperation({ summary: 'Create a draft workout (no sessions yet)' })
  @ApiResponse({ status: 201, description: 'Draft created.' })
  @ApiResponse({ status: 400, description: 'Invalid values.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Post()
  async create(
    @Param('studentId') studentId: string,
    @Body() dto: CreateWorkoutDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutTreeResponseDTO> {
    return await this.service.create(req.user.id, studentId, dto);
  }

  @ApiOperation({
    summary: 'Conflicts of library exercises with the student restrictions',
    description:
      'Only the restrictions that intersect are returned, per exercise id.',
  })
  @ApiResponse({ status: 200, description: 'Conflicts computed.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @HttpCode(200)
  @Post('conflicts')
  async conflicts(
    @Param('studentId') studentId: string,
    @Body() dto: ConflictsRequestDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<ConflictsResponseDTO> {
    return await this.service.conflicts(req.user.id, studentId, dto);
  }

  @ApiOperation({ summary: 'A workout with sessions, exercises and conflicts' })
  @ApiResponse({ status: 200, description: 'Workout found.' })
  @ApiResponse({ status: 404, description: 'Student or workout not found.' })
  @Get(':workoutId')
  async get(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutTreeResponseDTO> {
    return await this.service.get(req.user.id, studentId, workoutId);
  }

  @ApiOperation({
    summary: 'Save the whole workout',
    description:
      'Applies the tree as one transaction, keeping the ids of existing sessions and exercises. The active workout must stay valid (422 `workout_active_invalid`).',
  })
  @ApiResponse({ status: 200, description: 'Workout saved.' })
  @ApiResponse({ status: 400, description: 'Invalid values or foreign ids.' })
  @ApiResponse({ status: 404, description: 'Student or workout not found.' })
  @ApiResponse({
    status: 422,
    description: 'The active workout became invalid.',
  })
  @Put(':workoutId')
  async save(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Body() dto: SaveWorkoutDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutTreeResponseDTO> {
    return await this.service.save(req.user.id, studentId, workoutId, dto);
  }

  @ApiOperation({
    summary: 'Activate a workout',
    description:
      'Archives the current active workout. Every session needs an exercise (422 `workout_not_activatable`).',
  })
  @ApiResponse({ status: 200, description: 'Workout active.' })
  @ApiResponse({ status: 404, description: 'Student or workout not found.' })
  @ApiResponse({ status: 422, description: 'A session has no exercise.' })
  @HttpCode(200)
  @Post(':workoutId/activate')
  async activate(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutTreeResponseDTO> {
    return await this.service.activate(req.user.id, studentId, workoutId);
  }

  @ApiOperation({ summary: 'Deactivate (archive) the active workout' })
  @ApiResponse({ status: 200, description: 'Workout archived.' })
  @ApiResponse({ status: 404, description: 'Student or workout not found.' })
  @HttpCode(200)
  @Post(':workoutId/deactivate')
  async deactivate(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutTreeResponseDTO> {
    return await this.service.deactivate(req.user.id, studentId, workoutId);
  }

  @ApiOperation({ summary: 'Delete a draft or archived workout' })
  @ApiResponse({ status: 204, description: 'Workout deleted.' })
  @ApiResponse({ status: 404, description: 'Student or workout not found.' })
  @ApiResponse({
    status: 409,
    description: 'The active workout (`workout_is_active`).',
  })
  @HttpCode(204)
  @Delete(':workoutId')
  async remove(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(req.user.id, studentId, workoutId);
  }

  @ApiOperation({
    summary: 'Copy a workout to 1 to 20 of the educator students as drafts',
  })
  @ApiResponse({ status: 201, description: 'Drafts created.' })
  @ApiResponse({ status: 400, description: 'Too many targets.' })
  @ApiResponse({ status: 404, description: 'Workout or a target not found.' })
  @Post(':workoutId/duplicate')
  async duplicate(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Body() dto: DuplicateWorkoutDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<DuplicateResponseDTO> {
    return await this.service.duplicate(req.user.id, studentId, workoutId, dto);
  }
}
