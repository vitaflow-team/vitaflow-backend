import {
  ProductGroupWithDetails,
  ProductWithInfos,
  ProductsRepository,
} from '@/repositories/product/product.repository';
import { Injectable } from '@nestjs/common';
import { PlanCategory, typeOfCategory } from './planCategory';

@Injectable()
export class ProductsService {
  constructor(private products: ProductsRepository) {}

  async getProducts(): Promise<ProductGroupWithDetails[]> {
    return await this.products.getAllProducts();
  }

  // `category` arrives already validated by PlansQueryDTO, so the only
  // mapping left is API name -> stored type; no category means every plan.
  async listPlans(category?: PlanCategory): Promise<ProductWithInfos[]> {
    return await this.products.listPlans(
      category ? typeOfCategory(category) : undefined,
    );
  }

  async getProductById(id: string): Promise<ProductWithInfos | null> {
    return await this.products.getProductById(id);
  }
}
