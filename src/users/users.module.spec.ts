import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RecoverpassController } from './recoverpass/recoverpass.controller';
import { RecoverpassService } from './recoverpass/recoverpass.service';
import { SignInController } from './signin/signin.controller';
import { SignInService } from './signin/signin.service';
import { SignUpController } from './signup/signup.controller';
import { SignUpService } from './signup/signup.service';
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

  it('should register SignInController controller', () => {
    const signincontroller = moduleRef.get<SignInController>(SignInController);
    expect(signincontroller).toBeDefined();
  });

  it('should register SignUpController controller', () => {
    const signupcontroller = moduleRef.get<SignUpController>(SignUpController);
    expect(signupcontroller).toBeDefined();
  });

  it('should register SignUpController controller', () => {
    const recoverpassController = moduleRef.get<RecoverpassController>(
      RecoverpassController,
    );
    expect(recoverpassController).toBeDefined();
  });

  it('should register ProfileController controller', () => {
    const profileController =
      moduleRef.get<ProfileController>(ProfileController);
    expect(profileController).toBeDefined();
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

  it('should register ClientsRepository provider', () => {
    const clientsRepository =
      moduleRef.get<ClientsRepository>(ClientsRepository);
    expect(clientsRepository).toBeDefined();
  });

  it('should register UploadService provider', () => {
    const uploadService = moduleRef.get<UploadService>(UploadService);
    expect(uploadService).toBeDefined();
  });

  it('should register SignUpService provider', () => {
    const signUpService = moduleRef.get<SignUpService>(SignUpService);
    expect(signUpService).toBeDefined();
  });

  it('should register SignInService provider', () => {
    const signInService = moduleRef.get<SignInService>(SignInService);
    expect(signInService).toBeDefined();
  });

  it('should register RecoverpassService', () => {
    const recoverpassService =
      moduleRef.get<RecoverpassService>(RecoverpassService);
    expect(recoverpassService).toBeDefined();
  });

  it('should register ProfileService', () => {
    const profileService = moduleRef.get<ProfileService>(ProfileService);
    expect(profileService).toBeDefined();
  });
});
