import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsModule } from './clients.module';
import { ClientRegisterController } from './register/client.register.controller';
import { ClientRegisterService } from './register/client.register.service';

describe('UsersModule Test', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    // ClientsModule now imports BillingModule (best-effort invoice
    // cancellation on removal), which reads these two from ConfigService.
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      Buffer.alloc(32, 9).toString('base64');
    process.env.API_PUBLIC_URL =
      process.env.API_PUBLIC_URL ?? 'https://api.vitaflow.test';
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ClientsModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register ClientRegisterController controller', () => {
    const controller = moduleRef.get<ClientRegisterController>(
      ClientRegisterController,
    );
    expect(controller).toBeDefined();
  });

  it('should register PrismaService', () => {
    const prismaService = moduleRef.get<PrismaService>(PrismaService);
    expect(prismaService).toBeDefined();
  });

  it('should register UserRepository', () => {
    const userRepository = moduleRef.get<UserRepository>(UserRepository);
    expect(userRepository).toBeDefined();
  });

  it('should register ClientsRepository', () => {
    const clientsRepository =
      moduleRef.get<ClientsRepository>(ClientsRepository);
    expect(clientsRepository).toBeDefined();
  });

  it('should register ClientRegisterService', () => {
    const clientRegisterService = moduleRef.get<ClientRegisterService>(
      ClientRegisterService,
    );
    expect(clientRegisterService).toBeDefined();
  });
});
