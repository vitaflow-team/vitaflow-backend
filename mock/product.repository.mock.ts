import {
  ProductsRepository,
  ProductWithInfos,
} from '@/repositories/product/product.repository';
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
    stripeId: 'st_456',
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

// The flat catalog `listPlans` serves: unlike `productsMock` it spans every
// category, so filtering by one really narrows the result, and its prices
// are deliberately out of order with one tie so ordering is observable.
export const planProductsMock = [
  {
    id: 'plan-free',
    name: 'Gratuito',
    price: 0,
    type: 'USER',
    groupId: 'group-1',
    stripeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [],
  },
  {
    id: 'plan-premium',
    name: 'Premium',
    price: 29.9,
    type: 'USER',
    groupId: 'group-1',
    stripeId: 'st_premium',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [],
  },
  {
    id: 'plan-nutri-basic',
    name: 'Básico',
    price: 59.9,
    type: 'NUTRITIONIST',
    groupId: 'group-2',
    stripeId: 'st_nutri_basic',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [],
  },
  {
    id: 'plan-nutri-pro',
    name: 'Profissional',
    price: 59.9,
    type: 'NUTRITIONIST',
    groupId: 'group-2',
    stripeId: 'st_nutri_pro',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [],
  },
  {
    id: 'plan-edu',
    name: 'Profissional',
    price: 79.9,
    type: 'PHYSICAL_EDUCATOR',
    groupId: 'group-3',
    stripeId: 'st_edu',
    createdAt: new Date(),
    updatedAt: new Date(),
    productInfos: [],
  },
] as unknown as ProductWithInfos[];

// The Gratuito row every signup path now connects new users to: a USER
// product priced at zero with no Stripe price id.
export const freeProductMock = {
  id: 'free-1',
  name: 'Gratuito',
  price: 0,
  type: 'USER',
  groupId: 'group-1',
  stripeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Product;

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
    findByStripeId: jest.fn().mockImplementation((stripeId: string) => {
      const product = productsMock.find(
        (product: Product) => product.stripeId === stripeId,
      );
      return Promise.resolve(product ?? null);
    }),
    listPlans: jest.fn().mockImplementation((type?: string) => {
      const plans = type
        ? planProductsMock.filter((plan) => plan.type === type)
        : planProductsMock;
      return Promise.resolve(
        [...plans].sort(
          (a, b) => a.price - b.price || a.name.localeCompare(b.name),
        ),
      );
    }),
    findFreeProduct: jest.fn().mockImplementation(() => {
      return Promise.resolve(freeProductMock);
    }),
  },
};
