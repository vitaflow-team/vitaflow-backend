import { AuthModule } from '@/auth/auth.module';
import { ClientsModule } from '@/clients/clients.module';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ProfessionalDiscoveryRepository } from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ConnectionRequestsController } from './connectionRequests.controller';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';
import { ProfessionalProfileController } from './professionalProfile.controller';
import { ProfessionalSearchController } from './professionalSearch.controller';

@Module({
  imports: [AuthModule, ClientsModule, NotificationsModule],
  controllers: [
    ProfessionalSearchController,
    ConnectionRequestsController,
    ProfessionalProfileController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ProfessionalDiscoveryRepository,
    ProfessionalGuard,
    ProfessionalDiscoveryService,
  ],
})
export class ProfessionalDiscoveryModule {}
