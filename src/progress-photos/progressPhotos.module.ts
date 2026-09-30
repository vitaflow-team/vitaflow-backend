import { AuthModule } from '@/auth/auth.module';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PremiumGuard } from '@/common/guards/premium.guard';
import { PrismaService } from '@/database/prisma.service';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { ProgressPhotosController } from './progressPhotos.controller';
import { ProgressPhotosService } from './progressPhotos.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgressPhotosController],
  providers: [
    PrismaService,
    UserRepository,
    ProgressPhotosRepository,
    ConsentRepository,
    ConsentService,
    UploadService,
    PremiumGuard,
    ProgressPhotosService,
  ],
})
export class ProgressPhotosModule {}
