import { AuthModule } from '@/auth/auth.module';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { MealPlansController } from './mealPlans.controller';
import { MealPlansService } from './mealPlans.service';

@Module({
  imports: [AuthModule],
  controllers: [MealPlansController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    ProfessionalGuard,
    MealPlansRepository,
    MealPlansService,
  ],
  exports: [MealPlansService],
})
export class MealPlansModule {}
