import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { PrismaService } from '@/database/prisma.service';
import { ProfessionalDiscoveryRepository } from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionRequestsController } from './connectionRequests.controller';
import { ProfessionalDiscoveryModule } from './professionalDiscovery.module';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';
import { ProfessionalProfileController } from './professionalProfile.controller';
import { ProfessionalSearchController } from './professionalSearch.controller';

describe('ProfessionalDiscoveryModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ProfessionalDiscoveryModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register all three controllers', () => {
    expect(moduleRef.get(ProfessionalSearchController)).toBeDefined();
    expect(moduleRef.get(ConnectionRequestsController)).toBeDefined();
    expect(moduleRef.get(ProfessionalProfileController)).toBeDefined();
  });

  it('should register every dependency ProfessionalDiscoveryService needs', () => {
    expect(moduleRef.get(ProfessionalDiscoveryService)).toBeDefined();
    expect(moduleRef.get(ProfessionalDiscoveryRepository)).toBeDefined();
    expect(moduleRef.get(ProfessionalGuard)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
