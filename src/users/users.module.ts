import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { PasswordHash } from '@/utils/password.hash';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SinginController } from './singin/singin.controller';
import { SingupController } from './singup/singup.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [SingupController, SinginController],
  providers: [PasswordHash, PrismaService, UserRepository],
})
export class UsersModule {}
