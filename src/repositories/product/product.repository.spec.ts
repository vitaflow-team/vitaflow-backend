import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Product } from '@prisma/client';
import { planProductsMock, productsMock } from 'mock/product.repository.mock';
import {
  ProductGroupWithDetails,
  ProductsRepository,
  ProductWithGroup,
  ProductWithInfos,
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
        tier: 'STANDARD',
        active: true,
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
  tier: 'STANDARD',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const existingProductMock: Product = {
  id: 'prod-existing',
  name: 'Premium',
  price: 29.9,
  type: 'USER',
  groupId: 'group-1',
  tier: 'STANDARD',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const productWithGroupMock: ProductWithGroup = {
  ...existingProductMock,
  group: {
    id: 'group-1',
    name: 'Usuário',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
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
              create: jest.fn().mockResolvedValue(productWithGroupMock),
              update: jest.fn().mockResolvedValue(existingProductMock),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $transaction: jest
              .fn()
              .mockImplementation((callback: (tx: unknown) => unknown) =>
                callback(prismaService),
              ),
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
            where: { active: true },
            include: {
              productInfos: true,
            },
          },
        },
      });
    });

    // UT-010
    it('narrows nested products to active: true only (ADR-008)', async () => {
      await productsRepository.getAllProducts();

      const [args] = (prismaService.productGroup.findMany as jest.Mock).mock
        .calls[0] as [{ include: { products: { where: unknown } } }];
      expect(args.include.products.where).toEqual({ active: true });
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

    // UT-011
    it('is never filtered by active — resolves regardless of active state', async () => {
      await productsRepository.getProductById('1');

      const [args] = (prismaService.product.findUnique as jest.Mock).mock
        .calls[0] as [Record<string, unknown>];
      expect(args).not.toHaveProperty('where.active');
    });
  });

  describe('listPlans (plan categories)', () => {
    // UT-005
    it('filters by the given type and orders by price then name', async () => {
      const result = await productsRepository.listPlans('NUTRITIONIST');

      expect(result).toEqual(planProductsMock);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.findMany).toHaveBeenCalledWith({
        where: { active: true, type: 'NUTRITIONIST' },
        orderBy: [{ price: 'asc' }, { name: 'asc' }],
        include: { productInfos: true },
      });
    });

    // UT-006
    it('asks for every active plan when no type is given', async () => {
      await productsRepository.listPlans();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: [{ price: 'asc' }, { name: 'asc' }],
        include: { productInfos: true },
      });
    });

    // UT-006
    it('returns an empty list when the category has no plans', async () => {
      jest.spyOn(prismaService.product, 'findMany').mockResolvedValueOnce([]);

      await expect(
        productsRepository.listPlans('PHYSICAL_EDUCATOR'),
      ).resolves.toEqual([]);
    });

    // UT-010
    it('never returns an inactive row (active: true always applied)', async () => {
      await productsRepository.listPlans('NUTRITIONIST');

      const [args] = (prismaService.product.findMany as jest.Mock).mock
        .calls[0] as [{ where: { active: boolean } }];
      expect(args.where.active).toBe(true);
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
        where: { type: 'USER', price: 0 },
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

  describe('listCatalog (backoffice full catalog)', () => {
    it('returns every product unfiltered, with its group, regardless of active state', async () => {
      jest
        .spyOn(prismaService.product, 'findMany')
        .mockResolvedValueOnce([productWithGroupMock]);

      const result = await productsRepository.listCatalog();

      expect(result).toEqual([productWithGroupMock]);

      const [args] = (prismaService.product.findMany as jest.Mock).mock
        .calls[0] as [Record<string, unknown>];
      expect(args).not.toHaveProperty('where');
      expect(args).toEqual({
        include: { group: true },
        orderBy: [{ type: 'asc' }, { tier: 'asc' }, { price: 'asc' }],
      });
    });
  });

  describe('createProduct', () => {
    it('creates a new row with active: true', async () => {
      const result = await productsRepository.createProduct({
        groupId: 'group-1',
        name: 'Premium',
        price: 29.9,
        type: 'USER',
        tier: 'STANDARD',
      });

      expect(result).toEqual(productWithGroupMock);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          name: 'Premium',
          price: 29.9,
          type: 'USER',
          tier: 'STANDARD',
          active: true,
        },
        include: { group: true },
      });
    });
  });

  describe('repriceProduct (ADR-004 versioning)', () => {
    it('creates a new active row and deactivates the original, in one transaction', async () => {
      jest
        .spyOn(prismaService.product, 'findUnique')
        .mockResolvedValueOnce(existingProductMock);

      const result = await productsRepository.repriceProduct(
        existingProductMock.id,
        39.9,
      );

      expect(result).toEqual(productWithGroupMock);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.update).toHaveBeenCalledWith({
        where: { id: existingProductMock.id },
        data: { active: false },
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.create).toHaveBeenCalledWith({
        data: {
          groupId: existingProductMock.groupId,
          name: existingProductMock.name,
          price: 39.9,
          type: existingProductMock.type,
          tier: existingProductMock.tier,
          active: true,
        },
        include: { group: true },
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns null and touches nothing else when the product does not exist', async () => {
      jest
        .spyOn(prismaService.product, 'findUnique')
        .mockResolvedValueOnce(null);

      const result = await productsRepository.repriceProduct('missing', 39.9);

      expect(result).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.update).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.create).not.toHaveBeenCalled();
    });
  });

  describe('deactivateProduct', () => {
    it('sets active: false and reports success without deleting the row', async () => {
      const result = await productsRepository.deactivateProduct('prod-1');

      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prismaService.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { active: false },
      });
    });

    it('returns false when the product does not exist', async () => {
      jest
        .spyOn(prismaService.product, 'updateMany')
        .mockResolvedValueOnce({ count: 0 });

      const result = await productsRepository.deactivateProduct('missing');

      expect(result).toBe(false);
    });
  });
});
