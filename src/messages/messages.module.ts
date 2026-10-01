import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MessagesRepository } from '@/repositories/messages/messages.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MessagesController],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    MessagesRepository,
    MessagesService,
  ],
})
export class MessagesModule {}
