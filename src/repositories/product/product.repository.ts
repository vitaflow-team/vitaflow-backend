import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const productInclude = {
  productInfos: true,
} satisfies Prisma.ProductInclude;

export type ProductWithInfos = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

const productGroupInclude = {
  products: {
    include: productInclude,
  },
} satisfies Prisma.ProductGroupInclude;

export type ProductGroupWithDetails = Prisma.ProductGroupGetPayload<{
  include: typeof productGroupInclude;
}>;

@Injectable()
export class ProductsRepository {
  constructor(private prisma: PrismaService) {}

  async getProductById(id: string): Promise<ProductWithInfos | null> {
    return await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: productInclude,
    });
  }

  async getAllProducts(): Promise<ProductGroupWithDetails[]> {
    return (await this.prisma.productGroup.findMany({
      include: productGroupInclude,
    })) as ProductGroupWithDetails[];
  }
}
