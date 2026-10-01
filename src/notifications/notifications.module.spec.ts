import { PrismaService } from '@/database/prisma.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

describe('NotificationsModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [NotificationsModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register NotificationsController', () => {
    expect(moduleRef.get(NotificationsController)).toBeDefined();
  });

  it('should register every dependency NotificationsService needs', () => {
    expect(moduleRef.get(NotificationsService)).toBeDefined();
    expect(moduleRef.get(NotificationsRepository)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });

  it('exports NotificationsService for cross-module injection (ADR-002)', async () => {
    const consumerModule: TestingModule = await Test.createTestingModule({
      imports: [NotificationsModule],
    }).compile();

    expect(consumerModule.get(NotificationsService)).toBeInstanceOf(
      NotificationsService,
    );
  });
});
