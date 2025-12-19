import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClientRegisterController } from './register/client.register.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [ClientRegisterController],
  providers: [PrismaService, UserRepository, ClientsRepository],
})
export class ClientsModule {}
