import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { CalorieEstimationService } from './calorieEstimation.service';
import { FoodDiaryController } from './foodDiary.controller';
import { FoodDiaryModule } from './foodDiary.module';
import { FoodDiaryService } from './foodDiary.service';

describe('FoodDiaryModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [FoodDiaryModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register FoodDiaryController', () => {
    expect(moduleRef.get(FoodDiaryController)).toBeDefined();
  });

  it('should register every dependency FoodDiaryService needs', () => {
    expect(moduleRef.get(FoodDiaryService)).toBeDefined();
    expect(moduleRef.get(CalorieEstimationService)).toBeDefined();
    expect(moduleRef.get(MealsRepository)).toBeDefined();
    expect(moduleRef.get(WaterLogRepository)).toBeDefined();
    expect(moduleRef.get(FitnessProfileRepository)).toBeDefined();
    expect(moduleRef.get(MeasurementRecordsRepository)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
