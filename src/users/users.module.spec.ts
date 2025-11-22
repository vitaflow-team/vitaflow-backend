import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { RecoverpassController } from './recoverpass/recoverpass.controller';
import { SinginController } from './singin/singin.controller';
import { SingupController } from './singup/singup.controller';
import { UsersModule } from './users.module';

describe('UsersModule Test', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '12h' },
        }),
        UsersModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register SingInController controller', () => {
    const singincontroller = moduleRef.get<SinginController>(SinginController);
    expect(singincontroller).toBeDefined();
  });

  it('should register SingUpController controller', () => {
    const singupcontroller = moduleRef.get<SingupController>(SingupController);
    expect(singupcontroller).toBeDefined();
  });

  it('should register SingUpController controller', () => {
    const recoverpassController = moduleRef.get<RecoverpassController>(
      RecoverpassController,
    );
    expect(recoverpassController).toBeDefined();
  });

  it('should register PrismaService provider', () => {
    const prismaService = moduleRef.get<PrismaService>(PrismaService);
    expect(prismaService).toBeDefined();
  });

  it('should register PasswordHash provider', () => {
    const passwordHash = moduleRef.get<PasswordHash>(PasswordHash);
    expect(passwordHash).toBeDefined();
  });

  it('should register UserRepository provider', () => {
    const userRepository = moduleRef.get<UserRepository>(UserRepository);
    expect(userRepository).toBeDefined();
  });

  it('should register UserRepository provider', () => {
    const userTokenRepository =
      moduleRef.get<UserTokenRepository>(UserTokenRepository);
    expect(userTokenRepository).toBeDefined();
  });
});
