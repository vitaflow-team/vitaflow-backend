import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ClientRegisterController } from './register/client.register.controller';
import { ClientRegisterService } from './register/client.register.service';

@Module({
  imports: [AuthModule],
  controllers: [ClientRegisterController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    ClientRegisterService,
  ],
  // Exported so professional-discovery's accept() can call postRegister()
  // directly instead of reimplementing client creation (PRD Business Rules:
  // an accepted request must produce the exact same kind of relationship).
  exports: [ClientRegisterService],
})
export class ClientsModule {}
