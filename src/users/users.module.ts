import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RecoverpassController } from './recoverpass/recoverpass.controller';
import { RecoverpassService } from './recoverpass/recoverpass.service';
import { SignInController } from './signin/signin.controller';
import { SignInService } from './signin/signin.service';
import { SignUpController } from './signup/signup.controller';
import { SignUpService } from './signup/signup.service';

@Module({
  imports: [
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [
    SignUpController,
    SignInController,
    RecoverpassController,
    ProfileController,
  ],
  providers: [
    PasswordHash,
    PrismaService,
    UserRepository,
    UserTokenRepository,
    UploadService,
    ClientsRepository,
    SignUpService,
    SignInService,
    RecoverpassService,
    ProfileService,
  ],
})
export class UsersModule {}
