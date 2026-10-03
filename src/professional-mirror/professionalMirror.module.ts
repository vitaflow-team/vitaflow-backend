import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ProfessionalDiscoveryModule } from '@/professional-discovery/professionalDiscovery.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { FixedTimesModule } from '@/scheduling/fixed-times/fixedTimes.module';
import { Clock } from '@/scheduling/clock.service';
import { ProfessionalMirrorController } from './professionalMirror.controller';
import { ProfessionalMirrorService } from './professionalMirror.service';

@Module({
  imports: [AuthModule, ProfessionalDiscoveryModule, FixedTimesModule],
  controllers: [ProfessionalMirrorController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    PhysicalAssessmentsRepository,
    EducatorWorkoutsRepository,
    Clock,
    ProfessionalMirrorService,
  ],
})
export class ProfessionalMirrorModule {}
