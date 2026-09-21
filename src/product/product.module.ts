import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { ProductsController } from './product.controller';
import { ProductsService } from './product.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductsController, PlansController],
  providers: [
    PrismaService,
    UserRepository,
    ProductsRepository,
    ProductsService,
  ],
})
export class ProductsModule {}
