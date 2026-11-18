import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { PushCategoryPreferenceRepository } from '@/repositories/push/pushCategoryPreference.repository';
import { PushDeviceRepository } from '@/repositories/push/pushDevice.repository';
import { PushSettingsRepository } from '@/repositories/push/pushSettings.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushDevicesService } from './pushDevices.service';
import { PushSettingsService } from './pushSettings.service';
import { WebPushClient } from './webPush.client';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [
    PrismaService,
    UserRepository,
    PushDeviceRepository,
    PushCategoryPreferenceRepository,
    PushSettingsRepository,
    WebPushClient,
    PushDevicesService,
    PushSettingsService,
  ],
  exports: [
    WebPushClient,
    PushDevicesService,
    PushSettingsService,
    PushDeviceRepository,
    PushCategoryPreferenceRepository,
    PushSettingsRepository,
  ],
})
export class PushModule {}
