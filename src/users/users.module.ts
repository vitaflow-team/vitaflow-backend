import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProfileController } from './profile/profile.controller';
import { RecoverpassController } from './recoverpass/recoverpass.controller';
import { SinginController } from './singin/singin.controller';
import { SingupController } from './singup/singup.controller';

@Module({
  imports: [
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [
    SingupController,
    SinginController,
    RecoverpassController,
    ProfileController,
  ],
  providers: [PasswordHash, PrismaService, UserRepository, UserTokenRepository],
})
export class UsersModule {}
