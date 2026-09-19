import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { PrismaService } from './database/prisma.service';
import { MailModule } from './mail/mail.module';

import { ProductsModule } from './product/product.module';
import { ProgressModule } from './progress/progress.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    MailModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    ClientsModule,
    ProductsModule,
    ProgressModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
