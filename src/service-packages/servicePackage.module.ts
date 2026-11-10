import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { UserRepository } from '@/repositories/users/user.repository';
import { ServicePackageRepository } from '@/repositories/service-packages/servicePackage.repository';
import { Module } from '@nestjs/common';
import { ServicePackageController } from './servicePackage.controller';
import { ServicePackageService } from './servicePackage.service';

@Module({
  imports: [AuthModule],
  controllers: [ServicePackageController],
  providers: [
    PrismaService,
    UserRepository,
    ServicePackageRepository,
    ProfessionalGuard,
    ServicePackageService,
  ],
})
export class ServicePackageModule {}
