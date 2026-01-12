import { Test, TestingModule } from '@nestjs/testing';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { ProductsController } from './product.controller';
import { ProductsService } from './product.service';

describe('ProductsController Tests', () => {
  let controller: ProductsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [ProductsRepositoryMock, ProductsService],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('ProductsController.getProducts - Tests', () => {
    it('Should return all products - Success', async () => {
      const result = await controller.getProducts();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('ProductsController.getProductById - Tests', () => {
    it('Should return product - Not found', async () => {
      const result = await controller.getProductById('id-1');

      expect(result).not.toBeDefined();
    });

    it('Should return product - Success', async () => {
      const result = await controller.getProductById('1');

      expect(result?.id).toEqual('1');
    });
  });
});
