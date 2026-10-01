import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { ProfessionalMirrorController } from './professionalMirror.controller';
import { ProfessionalMirrorModule } from './professionalMirror.module';
import { ProfessionalMirrorService } from './professionalMirror.service';

describe('ProfessionalMirrorModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ProfessionalMirrorModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register ProfessionalMirrorController', () => {
    expect(moduleRef.get(ProfessionalMirrorController)).toBeDefined();
  });

  it('should register every dependency ProfessionalMirrorService needs', () => {
    expect(moduleRef.get(ProfessionalMirrorService)).toBeDefined();
    expect(moduleRef.get(ClientsRepository)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
