import { AuthModule } from '@/auth/auth.module';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { AssessmentTemplatesRepository } from '@/repositories/clinical-records/assessmentTemplates.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { AcademiaTemplatesController } from './templates/academiaTemplates.controller';
import { ProfessionalTemplatesController } from './templates/professionalTemplates.controller';
import { TemplatesService } from './templates/templates.service';
import { AcademiaFormRecordsController } from './records/academiaFormRecords.controller';
import { ProfessionalFormRecordsController } from './records/professionalFormRecords.controller';
import { FormRecordsService } from './records/formRecords.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ProfessionalTemplatesController,
    AcademiaTemplatesController,
    ProfessionalFormRecordsController,
    AcademiaFormRecordsController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    EmploymentRepository,
    ConsentRepository,
    ConsentService,
    ProfessionalGuard,
    AcademiaOwnerGuard,
    AssessmentTemplatesRepository,
    FormRecordsRepository,
    TemplatesService,
    FormRecordsService,
  ],
  exports: [TemplatesService],
})
export class ClinicalRecordsModule {}
