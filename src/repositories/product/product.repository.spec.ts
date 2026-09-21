import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Product } from '@prisma/client';
import { planProductsMock, productsMock } from 'mock/product.repository.mock';
import {
  ProductGroupWithDetails,
  ProductWithInfos,
  ProductsRepository,
} from './product.repository';

const productGroupsMock: ProductGroupWithDetails[] = [
  {
    id: 'group-1',
    name: 'Usuário',
    createdAt: new Date(),
    updatedAt: new Date(),
    products: [
      {
        id: 'prod-1',
        name: 'Premium',
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
    ],
  },
];

const freeProductMock: Product = {
  id: 'free-1',
  name: 'Gratuito',
  price: 0,
  type: 'USER',
  groupId: 'group-1',
  stripeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProductsRepository Tests', () => {
  let productsRepository: ProductsRepository;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        {
          provide: PrismaService,
          useValue: {
            productGroup: {
              findMany: jest.fn().mockResolvedValue(productGroupsMock),
            },
            product: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue(planProductsMock),
              findUnique: jest
                .fn()
                .mockImplementation(
                  (args: { where: { id: string } }) =>
                    productsMock.find(
                      (product: ProductWithInfos) =>
                        product.id === args.where.id,
                    ) || null,
                ),
            },
          },
        },
      ],
    }).compile();

    productsRepository = module.get<ProductsRepository>(ProductsRepository);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined and instantiated', () => {
    expect(productsRepository).toBeDefined();
  });

  describe('getAllProducts', () => {
    it('should return all product groups with nested products and infos', async () => {
      const result = await productsRepository.getAllProducts();

      expect(result).toEqual(productGroupsMock);
      expect(result.length).toBe(1);

      expect(result[0].products[0].name).toEqual('Premium');
      expect(result[0].products[0].productInfos.length).toBeGreaterThan(0);
      expect(result[0].products[0].productInfos[0].description).toEqual(
        'Suporte 24h',
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.productGroup.findMany).toHaveBeenCalledWith({
        include: {
          products: {
            include: {
              productInfos: true,
            },
          },
        },
      });
    });

    it('should return an empty array if no groups are found', async () => {
      jest
        .spyOn(prismaService.productGroup, 'findMany')
        .mockResolvedValueOnce([]);

      const result = await productsRepository.getAllProducts();

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  describe('getProductById', () => {
    it('should return product', async () => {
      const result = await productsRepository.getProductById('1');

      expect(result).toEqual(productsMock[0]);
      expect(result?.productInfos[0].description).toEqual('Suporte 24h');
    });

    it('should return null if no product is found', async () => {
      const result = await productsRepository.getProductById('123');

      expect(result).toEqual(null);
    });
  });

  describe('listPlans (plan categories)', () => {
    // UT-005
    it('filters by the given type and orders by price then name', async () => {
      const result = await productsRepository.listPlans('NUTRITIONIST');

      expect(result).toEqual(planProductsMock);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.findMany).toHaveBeenCalledWith({
        where: { type: 'NUTRITIONIST' },
        orderBy: [{ price: 'asc' }, { name: 'asc' }],
        include: { productInfos: true },
      });
    });

    // UT-006
    it('asks for every plan when no type is given', async () => {
      await productsRepository.listPlans();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.findMany).toHaveBeenCalledWith({
        orderBy: [{ price: 'asc' }, { name: 'asc' }],
        include: { productInfos: true },
      });

      const [args] = (prismaService.product.findMany as jest.Mock).mock
        .calls[0] as [Record<string, unknown>];
      expect(args).not.toHaveProperty('where');
    });

    // UT-006
    it('returns an empty list when the category has no plans', async () => {
      jest.spyOn(prismaService.product, 'findMany').mockResolvedValueOnce([]);

      await expect(
        productsRepository.listPlans('PHYSICAL_EDUCATOR'),
      ).resolves.toEqual([]);
    });
  });

  describe('findFreeProduct (free plan)', () => {
    // UT-001
    it('returns the Gratuito row matched by the free-plan rule', async () => {
      jest
        .spyOn(prismaService.product, 'findFirst')
        .mockResolvedValueOnce(freeProductMock);

      const result = await productsRepository.findFreeProduct();

      expect(result).toEqual(freeProductMock);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.findFirst).toHaveBeenCalledWith({
        where: { type: 'USER', price: 0, stripeId: null },
      });
    });

    // UT-002
    it('returns null when no product matches the rule', async () => {
      jest
        .spyOn(prismaService.product, 'findFirst')
        .mockResolvedValueOnce(null);

      const result = await productsRepository.findFreeProduct();

      expect(result).toBeNull();
    });
  });
});
