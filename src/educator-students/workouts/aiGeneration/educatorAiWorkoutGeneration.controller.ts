import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
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
import { WorkoutTreeResponseDTO } from '../dto/workoutResponse.Dto';
import { EducatorAiWorkoutConversationDTO } from './dto/educatorAiWorkoutConversation.Dto';
import { EducatorAiWorkoutConversationTurn } from './educatorAiWorkoutConversation.types';
import { EducatorAiWorkoutGenerationService } from './educatorAiWorkoutGeneration.service';

// Every route here requires Premium (PRD ADR-005, no free first use) —
// unlike meal-plans.controller.ts, which mixes Premium and non-Premium
// routes and so gates per-method instead.
@ApiTags('Educador físico — geração de treino por IA')
@ApiBearerAuth('jwt')
@Controller('educator/students/:studentId/workouts/ai-generation')
@UseGuards(AuthGuard, PhysicalEducatorGuard, ProfessionalPremiumGuard)
export class EducatorAiWorkoutGenerationController {
  constructor(
    private readonly generation: EducatorAiWorkoutGenerationService,
  ) {}

  @ApiOperation({
    summary: 'Start or continue the AI workout generation conversation',
    description:
      'Empty body (no conversationId) starts a new intake for this student; pass workoutId to regenerate that exact draft instead of creating a new one. Otherwise carries the answer to the previous question. Requires the Premium plan.',
  })
  @ApiResponse({
    status: 200,
    description: 'Next question, or the generated draft once complete.',
  })
  @ApiResponse({
    status: 409,
    description:
      'The targeted draft was edited since its last generation; resend with `confirmOverwrite: true`.',
  })
  @ApiResponse({
    status: 422,
    description:
      'No eligible exercises for the given restrictions/equipment/muscle-focus combination.',
  })
  @HttpCode(200)
  @Post('conversation')
  async postConversation(
    @Param('studentId') studentId: string,
    @Body() dto: EducatorAiWorkoutConversationDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<EducatorAiWorkoutConversationTurn | WorkoutTreeResponseDTO> {
    if (!dto.conversationId) {
      return await this.generation.startConversation(
        req.user.id,
        studentId,
        dto.workoutId,
        dto.confirmOverwrite,
      );
    }

    return await this.generation.answer(
      req.user.id,
      dto.conversationId,
      dto.answer ?? '',
    );
  }
}
