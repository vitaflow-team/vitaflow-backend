import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { PasswordHash } from '@/utils/password.hash';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
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
});
