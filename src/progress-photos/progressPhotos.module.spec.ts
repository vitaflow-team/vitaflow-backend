import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PremiumGuard } from '@/common/guards/premium.guard';
import { PrismaService } from '@/database/prisma.service';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UploadService } from '@/utils/upload.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ProgressPhotosController } from './progressPhotos.controller';
import { ProgressPhotosModule } from './progressPhotos.module';
import { ProgressPhotosService } from './progressPhotos.service';

describe('ProgressPhotosModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ProgressPhotosModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register ProgressPhotosController', () => {
    expect(moduleRef.get(ProgressPhotosController)).toBeDefined();
  });

  it('should register every dependency ProgressPhotosService needs', () => {
    expect(moduleRef.get(ProgressPhotosService)).toBeDefined();
    expect(moduleRef.get(ProgressPhotosRepository)).toBeDefined();
    expect(moduleRef.get(ConsentService)).toBeDefined();
    expect(moduleRef.get(ConsentRepository)).toBeDefined();
    expect(moduleRef.get(UploadService)).toBeDefined();
    expect(moduleRef.get(PremiumGuard)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
