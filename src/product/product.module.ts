import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { ProductsController } from './product.controller';
import { ProductsService } from './product.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductsController],
  providers: [
    PrismaService,
    UserRepository,
    ProductsRepository,
    ProductsService,
  ],
})
export class ProductsModule {}
