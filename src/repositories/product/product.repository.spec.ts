import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ProductGroupWithDetails,
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
});
