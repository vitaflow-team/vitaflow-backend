import { AuthModule } from '@/auth/auth.module';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { NutritionistPatientsController } from './nutritionistPatients.controller';
import { NutritionistPatientsService } from './nutritionistPatients.service';

@Module({
  imports: [AuthModule],
  controllers: [NutritionistPatientsController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    NutritionistGuard,
    NutritionistPatientsService,
  ],
})
export class NutritionistPatientsModule {}
