import { CodedError } from '@/common/errors/codedError';
import {
  CreateProductData,
  ProductsRepository,
  ProductWithGroup,
} from '@/repositories/product/product.repository';
import { Injectable } from '@nestjs/common';
import { ProductTier, ProductType } from '@prisma/client';

const PRODUCT_NOT_FOUND = 'Produto não encontrado.';
const INVALID_PRICE = 'O preço deve ser maior que zero.';
const INVALID_NAME = 'O nome não pode estar vazio.';

export interface ProductCatalogEntry {
  id: string;
  name: string;
  price: number;
  type: ProductType;
  tier: ProductTier;
  active: boolean;
  groupId: string;
  groupName: string;
}

export interface CreateProductInput {
  groupId: string;
  name: string;
  price: number;
  type: ProductType;
  tier: ProductTier;
}

// Orchestrates the platform catalog admin API (ADR-007): reads reuse
// `ProductsRepository.listCatalog` (unfiltered — both active and inactive,
// unlike the public-facing `listPlans`/`getAllProducts`); writes delegate the
// versioning mechanism (ADR-004) entirely to the repository's own
// transaction, so this service never splits a reprice into two separate,
// non-atomic repository calls.
@Injectable()
export class PlansService {
  constructor(private readonly products: ProductsRepository) {}

  async listCatalog(): Promise<ProductCatalogEntry[]> {
    const products = await this.products.listCatalog();
    return products.map((product) => this.toCatalogEntry(product));
  }

  async createProduct(input: CreateProductInput): Promise<ProductCatalogEntry> {
    this.assertValidName(input.name);
    this.assertValidPrice(input.price);

    const data: CreateProductData = input;
    const created = await this.products.createProduct(data);
    return this.toCatalogEntry(created);
  }

  // Creates a new active row (same group/type/tier) and deactivates
  // `productId`'s row, in one transaction (ADR-004) — never a price edit in
  // place. Succeeds regardless of whether any `Users` row references the
  // product (no special-cased subscriber-count branch).
  async repriceProduct(
    productId: string,
    newPrice: number,
  ): Promise<ProductCatalogEntry> {
    this.assertValidPrice(newPrice);

    const repriced = await this.products.repriceProduct(productId, newPrice);
    if (!repriced) {
      throw new CodedError(PRODUCT_NOT_FOUND, 404, 'product_not_found');
    }
    return this.toCatalogEntry(repriced);
  }

  // Soft-retire only. Succeeds regardless of whether any `Users` row
  // references the product, including deactivating the only active product
  // for a role/tier.
  async deactivateProduct(productId: string): Promise<void> {
    const deactivated = await this.products.deactivateProduct(productId);
    if (!deactivated) {
      throw new CodedError(PRODUCT_NOT_FOUND, 404, 'product_not_found');
    }
  }

  private assertValidName(name: string): void {
    if (!name.trim()) {
      throw new CodedError(INVALID_NAME, 400, 'invalid_name');
    }
  }

  private assertValidPrice(price: number): void {
    if (price <= 0) {
      throw new CodedError(INVALID_PRICE, 400, 'invalid_price');
    }
  }

  private toCatalogEntry(product: ProductWithGroup): ProductCatalogEntry {
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      type: product.type,
      tier: product.tier,
      active: product.active,
      groupId: product.groupId,
      groupName: product.group.name,
    };
  }
}
