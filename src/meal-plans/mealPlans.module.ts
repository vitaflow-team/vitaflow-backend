import { AuthModule } from '@/auth/auth.module';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ClientNutritionProfileRepository } from '@/repositories/meal-plans/clientNutritionProfile.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { openAiClientProvider } from '@/workouts/openaiClient.provider';
import { Module } from '@nestjs/common';
import { MealPlansController } from './mealPlans.controller';
import { MealPlansService } from './mealPlans.service';
import { MealPlanGenerationService } from './mealPlanGeneration.service';
import { MealPlanLlmService } from './mealPlanLlm.service';

@Module({
  imports: [AuthModule],
  controllers: [MealPlansController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    ProfessionalGuard,
    ProfessionalPremiumGuard,
    MealPlansRepository,
    MealPlansService,
    ClientNutritionProfileRepository,
    openAiClientProvider,
    MealPlanLlmService,
    // This module's own `ConversationStore` instance (ADR-009) — a
    // separate `Map` from the workout generator's, never sharing data,
    // since each module declares the provider in its own `providers` array.
    ConversationStore,
    MealPlanGenerationService,
  ],
  // MealPlansRepository is also exported for pdf-export (ADR-010): it needs
  // the raw MealPlanWithDays shape (e.g. `status`), which MealPlansService's
  // DTO-mapped return types strip.
  exports: [MealPlansService, MealPlansRepository],
})
export class MealPlansModule {}
