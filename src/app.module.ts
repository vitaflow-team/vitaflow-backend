import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { ApiKeyGuard } from './common/guards/apiKey.guard';
import { PrismaService } from './database/prisma.service';
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
    ProfessionalDiscoveryModule,
    ProfessionalMirrorModule,
    MessagesModule,
    SchedulingModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
