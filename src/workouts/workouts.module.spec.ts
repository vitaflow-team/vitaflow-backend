import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationStore } from './conversationStore';
import { LlmExplanationService } from './llmExplanation.service';
import { RuleEngineService } from './ruleEngine.service';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsModule } from './workouts.module';
import { WorkoutsService } from './workouts.service';

describe('WorkoutsModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkoutsModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register WorkoutsController', () => {
    expect(moduleRef.get(WorkoutsController)).toBeDefined();
  });

  it('should register WorkoutsService', () => {
    expect(moduleRef.get(WorkoutsService)).toBeDefined();
  });

  it('should register every dependency WorkoutsService needs', () => {
    expect(moduleRef.get(PrismaService)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(ExercisesRepository)).toBeDefined();
    expect(moduleRef.get(FitnessProfileRepository)).toBeDefined();
    expect(moduleRef.get(WorkoutsRepository)).toBeDefined();
    expect(moduleRef.get(RuleEngineService)).toBeDefined();
    expect(moduleRef.get(LlmExplanationService)).toBeDefined();
    expect(moduleRef.get(ConversationStore)).toBeDefined();
  });
});
