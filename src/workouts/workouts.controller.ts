import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { WorkoutWithDetails } from '@/repositories/workouts/workouts.repository';
import {
  Body,
  Controller,
  Get,
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
import { ConversationTurnEntity } from './conversationTurn.entity';
import { AnswerConversationDto } from './dto/answerConversation.Dto';
import { GenerateWorkoutDto } from './dto/generateWorkout.Dto';
import { UpdateWorkoutExerciseDto } from './dto/updateWorkoutExercise.Dto';
import { ConversationTurnResult } from './workouts.types';
import { CurrentWorkoutResponseEntity, WorkoutEntity } from './workout.entity';
import { WorkoutsService } from './workouts.service';

@ApiTags('Workouts')
@Controller('workouts')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class WorkoutsController {
  constructor(private readonly service: WorkoutsService) {}

  @ApiOperation({
    summary: 'Start or continue the AI workout conversation',
    description:
      'Empty body starts a new conversation; otherwise carries the answer to the previous question.',
  })
  @ApiResponse({
    status: 200,
    description: 'Next question, or the generated workout once complete.',
    type: ConversationTurnEntity,
  })
  @Post('conversation')
  async postConversation(
    @Body() dto: AnswerConversationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ConversationTurnResult | WorkoutWithDetails> {
    if (!dto.conversationId) {
      return await this.service.startConversation(req.user.id);
    }
    return await this.service.answer(
      req.user.id,
      dto.conversationId,
      dto.answer ?? '',
    );
  }

  @ApiOperation({
    summary: 'Generate (or regenerate) the current workout',
    description:
      'The first generation is free; regenerating an existing workout requires Premium.',
  })
  @ApiResponse({ status: 200, type: WorkoutEntity })
  @ApiResponse({
    status: 402,
    description: 'Regeneration requires the Premium plan.',
  })
  @ApiResponse({
    status: 422,
    description: 'Not enough matching exercises for the given criteria.',
  })
  @Post('generate')
  async postGenerate(
    @Body() dto: GenerateWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutWithDetails> {
    return await this.service.regenerate(req.user.id, dto.daysPerWeek);
  }

  @ApiOperation({ summary: "Get the user's current workout" })
  @ApiResponse({
    status: 200,
    description: '`workout` is null when none was generated yet.',
    type: CurrentWorkoutResponseEntity,
  })
  @Get('current')
  async getCurrent(
    @Request() req: AuthenticatedRequest,
  ): Promise<{ workout: WorkoutWithDetails | null }> {
    // Never a bare `null` body: NestJS sends 200 with an EMPTY body (not
    // 204) for a raw `null` return, which breaks every JSON-parsing HTTP
    // client (found via manual verification) — wrapping in an object is
    // this codebase's existing convention for "no data yet"
    // (LatestRecordResponseDTO does the same for progress records).
    return { workout: await this.service.getCurrent(req.user.id) };
  }

  @ApiOperation({
    summary: 'Manually edit one exercise of the current workout',
    description:
      'Swap the exercise, change sets/reps, or remove it from its day.',
  })
  @ApiResponse({ status: 200, type: WorkoutEntity })
  @ApiResponse({
    status: 400,
    description: 'Invalid edit (empty day, out-of-range sets/reps).',
  })
  @Patch('exercises/:workoutExerciseId')
  async patchExercise(
    @Param('workoutExerciseId') workoutExerciseId: string,
    @Body() dto: UpdateWorkoutExerciseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<WorkoutWithDetails> {
    return await this.service.updateExercise(
      req.user.id,
      workoutExerciseId,
      dto,
    );
  }
}
