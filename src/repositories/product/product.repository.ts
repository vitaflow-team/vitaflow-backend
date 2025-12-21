import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const productGroupInclude = {
  products: {
    include: {
      productInfos: true,
    },
  },
} satisfies Prisma.ProductGroupInclude;

export type ProductGroupWithDetails = Prisma.ProductGroupGetPayload<{
  include: typeof productGroupInclude;
}>;

@Injectable()
export class ProductsRepository {
  constructor(private prisma: PrismaService) {}

  async getAllProducts(): Promise<ProductGroupWithDetails[]> {
    return (await this.prisma.productGroup.findMany({
      include: productGroupInclude,
    })) as ProductGroupWithDetails[];
  }
}
