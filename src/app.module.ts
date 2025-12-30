import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule } from './clients/clients.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { PrismaService } from './database/prisma.service';
import { MailModule } from './mail/mail.module';
import { ProductsController } from './product/product.controller';
import { ProductsRepository } from './repositories/product/product.repository';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    MailModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
    UsersModule,
    ClientsModule,
  ],
  controllers: [ProductsController],
  providers: [
    PrismaService,
    ProductsRepository,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
