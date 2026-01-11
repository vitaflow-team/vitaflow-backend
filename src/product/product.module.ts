import { PrismaService } from '@/database/prisma.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProductsController } from './product.controller';
import { ProductsService } from './product.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [ProductsController],
  providers: [
    PrismaService,
    UserRepository,
    ProductsRepository,
    ProductsService,
  ],
})
export class ProductsModule {}
