import { ProductsRepository } from '@/repositories/product/product.repository';
import { Product } from '@prisma/client';

export const productsMock = [
  {
    id: '1',
    name: 'Product id 1',
    price: 19.9,
    type: 'USER',
    groupId: 'group-1',
    stripeId: 'st_123',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [
      {
        id: 'info-1',
        description: 'Suporte 24h',
        productId: 'prod-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  },
  {
    id: '2',
    name: 'Product id 2',
    price: 29.9,
    type: 'USER',
    groupId: 'group-1',
    stripeId: 'st_123',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [
      {
        id: 'info-1',
        description: 'Suporte 24h',
        productId: 'prod-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  },
  {
    id: '3',
    name: 'Product id 3',
    price: 39.9,
    type: 'USER',
    groupId: 'group-1',
    stripeId: 'st_123',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [
      {
        id: 'info-1',
        description: 'Suporte 24h',
        productId: 'prod-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  },
] as Product[];

export const ProductsRepositoryMock = {
  provide: ProductsRepository,
  useValue: {
    getProductById: jest.fn().mockImplementation((id: string) => {
      const product = productsMock.find(
        (product: Product) => product.id === id,
      );
      return Promise.resolve(product);
    }),
    getAllProducts: jest.fn().mockImplementation(() => {
      return Promise.resolve(productsMock);
    }),
  },
};
