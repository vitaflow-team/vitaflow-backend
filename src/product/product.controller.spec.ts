import {
  ProductGroupWithDetails,
  ProductsRepository,
} from '@/repositories/product/product.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductType } from '@prisma/client';
import { ProductsController } from './product.controller';
import { ProductsService } from './product.service';

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
        groupId: 'group-1',
        type: ProductType.USER,
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

describe('ProductsController Tests', () => {
  let controller: ProductsController;
  let productsRepository: ProductsRepository;

  const productsRepositoryMock = {
    getAllProducts: jest.fn().mockResolvedValue(productGroupsMock),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsRepository,
          useValue: productsRepositoryMock,
        },
        ProductsService,
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    productsRepository = module.get<ProductsRepository>(ProductsRepository);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(productsRepository).toBeDefined();
  });

  describe('ProductsController.getProducts - Tests', () => {
    it('Should return all products - Success', async () => {
      const result = await controller.getProducts();

      expect(result).toBeDefined();
      expect(result).toEqual(productGroupsMock);
      expect(productsRepositoryMock.getAllProducts).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toEqual('group-1');
    });
  });
});
