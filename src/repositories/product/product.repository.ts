import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, Product, ProductType } from '@prisma/client';

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

  // The plan list the Plano tab renders: a flat, price-ordered catalog
  // rather than the product groups `getAllProducts` returns. Name breaks
  // price ties so two plans of the same price keep a stable order.
  async listPlans(type?: ProductType): Promise<ProductWithInfos[]> {
    return await this.prisma.product.findMany({
      ...(type ? { where: { type } } : {}),
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      include: productInclude,
    });
  }

  async findByStripeId(stripeId: string): Promise<ProductWithInfos | null> {
    return await this.prisma.product.findFirst({
      where: { stripeId },
      include: productInclude,
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
