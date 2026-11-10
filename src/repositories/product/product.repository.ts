import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, Product, ProductTier, ProductType } from '@prisma/client';

const PRODUCT_INCLUDE = {
  productInfos: true,
} satisfies Prisma.ProductInclude;

export type ProductWithInfos = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

const PRODUCT_GROUP_INCLUDE = {
  products: {
    // ADR-008: the two public read endpoints (`GET /products`/`GET /plans`)
    // must never surface a deactivated (superseded) product to a new signup.
    where: { active: true },
    include: PRODUCT_INCLUDE,
  },
} satisfies Prisma.ProductGroupInclude;

export type ProductGroupWithDetails = Prisma.ProductGroupGetPayload<{
  include: typeof PRODUCT_GROUP_INCLUDE;
}>;

const PRODUCT_WITH_GROUP_INCLUDE = {
  group: true,
} satisfies Prisma.ProductInclude;

export type ProductWithGroup = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_WITH_GROUP_INCLUDE;
}>;

export interface CreateProductData {
  groupId: string;
  name: string;
  price: number;
  type: ProductType;
  tier: ProductTier;
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Never filtered by `active` (ADR-008): an existing subscriber's own
  // product lookup must keep resolving after their row is deactivated.
  async getProductById(id: string): Promise<ProductWithInfos | null> {
    return await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  // ADR-008: narrows to `active: true` products within each group — groups
  // themselves are never filtered, only the products nested under them.
  async getAllProducts(): Promise<ProductGroupWithDetails[]> {
    return (await this.prisma.productGroup.findMany({
      include: PRODUCT_GROUP_INCLUDE,
    })) as ProductGroupWithDetails[];
  }

  // The plan list the Plano tab renders: a flat, price-ordered catalog
  // rather than the product groups `getAllProducts` returns. Name breaks
  // price ties so two plans of the same price keep a stable order.
  // ADR-008: narrowed to `active: true` so new signups never see a
  // superseded price.
  async listPlans(type?: ProductType): Promise<ProductWithInfos[]> {
    return await this.prisma.product.findMany({
      where: { active: true, ...(type ? { type } : {}) },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      include: PRODUCT_INCLUDE,
    });
  }

  // Gratuito has no fixed id and no unique name (two products are called
  // Premium and two Profissional), so it is identified by what makes it the
  // free personal plan: a USER product that costs nothing. Exactly one
  // product is expected to match. Never filtered by `active` — signup-time
  // logic for the one always-current free tier.
  async findFreeProduct(): Promise<Product | null> {
    return await this.prisma.product.findFirst({
      where: { type: 'USER', price: 0 },
    });
  }

  // The backoffice catalog view (ADR-007): every product, every role/tier,
  // active and inactive alike — deliberately not `listPlans`/`getAllProducts`
  // now that those are narrowed to `active: true` (ADR-008).
  async listCatalog(): Promise<ProductWithGroup[]> {
    return await this.prisma.product.findMany({
      include: PRODUCT_WITH_GROUP_INCLUDE,
      orderBy: [{ type: 'asc' }, { tier: 'asc' }, { price: 'asc' }],
    });
  }

  async createProduct(data: CreateProductData): Promise<ProductWithGroup> {
    return await this.prisma.product.create({
      data: { ...data, active: true },
      include: PRODUCT_WITH_GROUP_INCLUDE,
    });
  }

  // ADR-004: never edits `productId`'s row in place. Creates a new active
  // row (same group/type/tier, new price) and deactivates the original row,
  // both inside one transaction — so a mid-transaction failure leaves
  // neither row changed. Returns `null` when `productId` doesn't exist.
  async repriceProduct(
    productId: string,
    newPrice: number,
  ): Promise<ProductWithGroup | null> {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!existing) {
        return null;
      }

      await tx.product.update({
        where: { id: productId },
        data: { active: false },
      });

      return await tx.product.create({
        data: {
          groupId: existing.groupId,
          name: existing.name,
          price: newPrice,
          type: existing.type,
          tier: existing.tier,
          active: true,
        },
        include: PRODUCT_WITH_GROUP_INCLUDE,
      });
    });
  }

  // Soft-retire only — the row is never deleted. Succeeds regardless of
  // whether any `Users` row currently references the product. Returns
  // `false` when `productId` doesn't exist.
  async deactivateProduct(productId: string): Promise<boolean> {
    const { count } = await this.prisma.product.updateMany({
      where: { id: productId },
      data: { active: false },
    });
    return count > 0;
  }
}
