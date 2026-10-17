import { AuthModule } from '@/auth/auth.module';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ProfessionalFoodDiaryController } from './professionalFoodDiary.controller';
import { ProfessionalFoodDiaryService } from './professionalFoodDiary.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalFoodDiaryController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    EmploymentRepository,
    MealsRepository,
    WaterLogRepository,
    ProfessionalGuard,
    ProfessionalFoodDiaryService,
  ],
})
export class ProfessionalFoodDiaryModule {}
