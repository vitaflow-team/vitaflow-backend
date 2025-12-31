import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsModule } from './clients.module';
import { ClientRegisterController } from './register/client.register.controller';
import { ClientRegisterService } from './register/client.register.service';

describe('UsersModule Test', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '12h' },
        }),
        ClientsModule,
      ],
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
