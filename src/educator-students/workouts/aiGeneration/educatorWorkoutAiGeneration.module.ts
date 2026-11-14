import { AuthModule } from '@/auth/auth.module';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { openAiClientProvider } from '@/workouts/openaiClient.provider';
import { RuleEngineService } from '@/workouts/ruleEngine.service';
import { Module } from '@nestjs/common';
import { EducatorAiWorkoutGenerationController } from './educatorAiWorkoutGeneration.controller';
import { EducatorAiWorkoutGenerationService } from './educatorAiWorkoutGeneration.service';
import { EducatorAiWorkoutLlmService } from './educatorAiWorkoutLlm.service';

// A new sibling module on AppModule (ai-workout-prescription-b2b ADR-008),
// not nested inside EducatorStudentsModule: that module has no file of its
// own, and WorkoutsController/EducatorWorkoutsService already use those
// class names in this folder for the manual flow. Mirrors MealPlansModule's
// structure exactly: reuses the shared openAiClientProvider, declares its
// own ConversationStore instance (never imported from elsewhere, so
// conversation state never leaks between features).
@Module({
  imports: [AuthModule],
  controllers: [EducatorAiWorkoutGenerationController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    EducatorWorkoutsRepository,
    ExercisesRepository,
    FitnessProfileRepository,
    RuleEngineService,
    PhysicalEducatorGuard,
    ProfessionalPremiumGuard,
    openAiClientProvider,
    EducatorAiWorkoutLlmService,
    ConversationStore,
    EducatorAiWorkoutGenerationService,
  ],
})
export class EducatorWorkoutAiGenerationModule {}
