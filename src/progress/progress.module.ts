import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [
    PrismaService,
    UserRepository,
    MeasurementRecordsRepository,
    ProgressService,
  ],
})
export class ProgressModule {}
