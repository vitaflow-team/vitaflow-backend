import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { Clock } from '@/scheduling/clock.service';
import { Module } from '@nestjs/common';
import { AcademiaMirrorController } from './academiaMirror.controller';
import { AcademiaMirrorService } from './academiaMirror.service';

// Own module (ADR-004) — deliberately does not import or extend
// ProfessionalMirrorModule; the gym-membership relationship shape (array,
// no ProductType) doesn't fit that module's single-professional-per-type
// design.
@Module({
  imports: [AuthModule],
  controllers: [AcademiaMirrorController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    StudentAccessPlanRepository,
    StudentAccessPlanService,
    AcademiaAccessPlanRepository,
    Clock,
    AcademiaMirrorService,
  ],
})
export class AcademiaMirrorModule {}
