import { AuthModule } from '@/auth/auth.module';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AssessmentsController } from './assessments/assessments.controller';
import { AssessmentsService } from './assessments/assessments.service';
import { DeclarationController } from './assessments/declaration.controller';
import { AccountLookupThrottlerGuard } from './students/accountLookupThrottler.guard';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';

@Module({
  imports: [
    AuthModule,
    // Own throttler storage: the account lookup limit is independent of the
    // auth routes' throttlers and keyed by the authenticated educator.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [
    StudentsController,
    AssessmentsController,
    DeclarationController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    PhysicalAssessmentsRepository,
    ConsentRepository,
    ConsentService,
    PhysicalEducatorGuard,
    AccountLookupThrottlerGuard,
    StudentsService,
    AssessmentsService,
  ],
})
export class EducatorStudentsModule {}
