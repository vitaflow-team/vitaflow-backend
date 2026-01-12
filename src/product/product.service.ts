import {
  ProductGroupWithDetails,
  ProductWithInfos,
  ProductsRepository,
} from '@/repositories/product/product.repository';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ProductsService {
  constructor(private products: ProductsRepository) {}

  async getProducts(): Promise<ProductGroupWithDetails[]> {
    return await this.products.getAllProducts();
  }

  async getProductById(id: string): Promise<ProductWithInfos | null> {
    return await this.products.getProductById(id);
  }
}
