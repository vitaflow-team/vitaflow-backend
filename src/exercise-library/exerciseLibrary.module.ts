import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ExerciseAdminController } from './exerciseAdmin.controller';
import { ExerciseLibraryService } from './exerciseLibrary.service';
import { ExerciseSubmissionsController } from './exerciseSubmissions.controller';
import { ExercisesController } from './exercises.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    ExerciseSubmissionsController,
    ExercisesController,
    ExerciseAdminController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ExercisesRepository,
    ExerciseLibraryService,
  ],
})
export class ExerciseLibraryModule {}
