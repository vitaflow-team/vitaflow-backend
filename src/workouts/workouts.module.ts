import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { Module } from '@nestjs/common';
import { ConversationStore } from './conversationStore';
import { LlmExplanationService } from './llmExplanation.service';
import { openAiClientProvider } from './openaiClient.provider';
import { RuleEngineService } from './ruleEngine.service';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkoutsController],
  providers: [
    PrismaService,
    UserRepository,
    ExercisesRepository,
    FitnessProfileRepository,
    WorkoutsRepository,
    RuleEngineService,
    LlmExplanationService,
    ConversationStore,
    openAiClientProvider,
    WorkoutsService,
  ],
})
export class WorkoutsModule {}
