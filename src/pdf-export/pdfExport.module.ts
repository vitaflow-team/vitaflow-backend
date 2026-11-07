import { AuthModule } from '@/auth/auth.module';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { Module } from '@nestjs/common';
import {
  EducatorWorkoutMirrorPdfController,
  EducatorWorkoutPdfController,
  FormRecordAcademiaPdfController,
  FormRecordProfessionalPdfController,
  MealPlanMirrorPdfController,
  MealPlanPdfController,
  WorkoutPdfController,
} from './pdfExport.controller';
import { PdfExportService } from './pdfExport.service';

// Own top-level module (ADR-010), mirroring ProfessionalMirrorModule's
// cross-module-aggregator shape exactly: rather than importing
// MealPlansModule/WorkoutsModule/EducatorStudentsModule/ClinicalRecordsModule
// (which would also pull in their own controllers/guards/throttlers), it
// re-provides only the repositories/services this module actually reads
// from, each already exported for this purpose by its owning module.
@Module({
  imports: [AuthModule],
  controllers: [
    MealPlanPdfController,
    MealPlanMirrorPdfController,
    WorkoutPdfController,
    EducatorWorkoutPdfController,
    EducatorWorkoutMirrorPdfController,
    FormRecordProfessionalPdfController,
    FormRecordAcademiaPdfController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    EmploymentRepository,
    MealPlansRepository,
    MealPlansService,
    WorkoutsRepository,
    EducatorWorkoutsRepository,
    FormRecordsRepository,
    ProfessionalGuard,
    PhysicalEducatorGuard,
    PdfExportService,
  ],
})
export class PdfExportModule {}
