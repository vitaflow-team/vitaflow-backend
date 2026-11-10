import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AcademiaModule } from './academia/academia.module';
import { AuthModule } from './auth/auth.module';
import { BackofficeModule } from './backoffice/backoffice.module';
import { BillingModule } from './billing/billing.module';
import { ClientsModule } from './clients/clients.module';
import { ClinicalRecordsModule } from './clinical-records/clinicalRecords.module';
import { ErrorMonitoringModule } from './error-monitoring/errorMonitoring.module';
import { SentryExceptionFilter } from './error-monitoring/sentryExceptionFilter';
import { MealPlansModule } from './meal-plans/mealPlans.module';
import { NutritionistPatientsModule } from './nutritionist-patients/nutritionistPatients.module';
import { PdfExportModule } from './pdf-export/pdfExport.module';
import { ProfessionalFoodDiaryModule } from './professional-food-diary/professionalFoodDiary.module';
import { ApiKeyGuard } from './common/guards/apiKey.guard';
import { ViewAsWriteBlockGuard } from './common/guards/viewAsWriteBlock.guard';
import { PrismaService } from './database/prisma.service';
import { BackofficeViewAsSessionRepository } from './repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from './repositories/users/user.repository';
import { EducatorStudentsModule } from './educator-students/educatorStudents.module';
import { ExerciseLibraryModule } from './exercise-library/exerciseLibrary.module';
import { FoodDiaryModule } from './food-diary/foodDiary.module';
import { MailModule } from './mail/mail.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';

import { ProductsModule } from './product/product.module';
import { ProfessionalDiscoveryModule } from './professional-discovery/professionalDiscovery.module';
import { ProfessionalMirrorModule } from './professional-mirror/professionalMirror.module';
import { ProgressModule } from './progress/progress.module';
import { ProgressPhotosModule } from './progress-photos/progressPhotos.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { ServicePackageModule } from './service-packages/servicePackage.module';
import { UsersModule } from './users/users.module';
import { WorkoutsModule } from './workouts/workouts.module';

@Module({
  imports: [
    MailModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // First use of this pattern in the project (scheduling TechSpec
    // Technical Dependencies) — powers ReminderCronService's polling.
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ClientsModule,
    ProductsModule,
    ProgressModule,
    ExerciseLibraryModule,
    WorkoutsModule,
    FoodDiaryModule,
    ProgressPhotosModule,
    NotificationsModule,
    // Registered before ProfessionalDiscoveryModule: its
    // GET /professionals/templates would otherwise be shadowed by
    // ProfessionalSearchController's unconstrained GET /professionals/:id,
    // registered first and matching "templates" as an id (discovered via
    // nutritionist-module task_06's end-to-end frontend verification).
    ClinicalRecordsModule,
    ProfessionalDiscoveryModule,
    ProfessionalMirrorModule,
    MessagesModule,
    SchedulingModule,
    EducatorStudentsModule,
    AcademiaModule,
    BackofficeModule,
    NutritionistPatientsModule,
    MealPlansModule,
    ProfessionalFoodDiaryModule,
    BillingModule,
    ErrorMonitoringModule,
    PdfExportModule,
    ServicePackageModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    UserRepository,
    BackofficeViewAsSessionRepository,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ViewAsWriteBlockGuard,
    },
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
  ],
})
export class AppModule {}
