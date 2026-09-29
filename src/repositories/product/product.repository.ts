import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, Product, ProductType } from '@prisma/client';

const PRODUCT_INCLUDE = {
  productInfos: true,
} satisfies Prisma.ProductInclude;

export type ProductWithInfos = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

const PRODUCT_GROUP_INCLUDE = {
  products: {
    include: PRODUCT_INCLUDE,
  },
} satisfies Prisma.ProductGroupInclude;

export type ProductGroupWithDetails = Prisma.ProductGroupGetPayload<{
  include: typeof PRODUCT_GROUP_INCLUDE;
}>;

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProductById(id: string): Promise<ProductWithInfos | null> {
    return await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  async getAllProducts(): Promise<ProductGroupWithDetails[]> {
    return (await this.prisma.productGroup.findMany({
      include: PRODUCT_GROUP_INCLUDE,
    })) as ProductGroupWithDetails[];
  }

  // The plan list the Plano tab renders: a flat, price-ordered catalog
  // rather than the product groups `getAllProducts` returns. Name breaks
  // price ties so two plans of the same price keep a stable order.
  async listPlans(type?: ProductType): Promise<ProductWithInfos[]> {
    return await this.prisma.product.findMany({
      ...(type ? { where: { type } } : {}),
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      include: PRODUCT_INCLUDE,
    });
  }

  async findByStripeId(stripeId: string): Promise<ProductWithInfos | null> {
    return await this.prisma.product.findFirst({
      where: { stripeId },
      include: PRODUCT_INCLUDE,
    });
  }

  // Gratuito has no fixed id and no unique name (two products are called
  // Premium and two Profissional), so it is identified by what makes it the
  // free personal plan: a USER product that costs nothing and was never
  // wired to a Stripe price. Exactly one product is expected to match.
  async findFreeProduct(): Promise<Product | null> {
    return await this.prisma.product.findFirst({
      where: { type: 'USER', price: 0, stripeId: null },
    });
  }
}
