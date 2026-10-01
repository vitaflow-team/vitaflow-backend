import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MessagesRepository } from '@/repositories/messages/messages.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesModule } from './messages.module';
import { MessagesService } from './messages.service';

describe('MessagesModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [MessagesModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register MessagesController', () => {
    expect(moduleRef.get(MessagesController)).toBeDefined();
  });

  it('should register every dependency MessagesService needs', () => {
    expect(moduleRef.get(MessagesService)).toBeDefined();
    expect(moduleRef.get(MessagesRepository)).toBeDefined();
    expect(moduleRef.get(ClientsRepository)).toBeDefined();
    expect(moduleRef.get(UserRepository)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
