import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ProfessionalDiscoveryModule } from '@/professional-discovery/professionalDiscovery.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ProfessionalMirrorController } from './professionalMirror.controller';
import { ProfessionalMirrorService } from './professionalMirror.service';

@Module({
  imports: [AuthModule, ProfessionalDiscoveryModule],
  controllers: [ProfessionalMirrorController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    PhysicalAssessmentsRepository,
    ProfessionalMirrorService,
  ],
})
export class ProfessionalMirrorModule {}
