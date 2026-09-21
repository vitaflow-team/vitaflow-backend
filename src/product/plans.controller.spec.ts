import { ProductsRepository } from '@/repositories/product/product.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { planProductsMock } from 'mock/product.repository.mock';
import { PlansController } from './plans.controller';
import { ProductsService } from './product.service';

describe('plan categories — GET /plans', () => {
  let controller: PlansController;
  let service: ProductsService;
  let products: { listPlans: jest.Mock };

  beforeEach(async () => {
    products = {
      listPlans: jest.fn().mockResolvedValue(planProductsMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        ProductsService,
        { provide: ProductsRepository, useValue: products },
      ],
    }).compile();

    controller = module.get<PlansController>(PlansController);
    service = module.get<ProductsService>(ProductsService);
  });

  describe('ProductsService.listPlans', () => {
    // UT-007
    it('maps the category to the stored type and returns the repository result', async () => {
      const result = await service.listPlans('EDUCADOR_FISICO');

      expect(products.listPlans).toHaveBeenCalledWith('PHYSICAL_EDUCATOR');
      expect(result).toEqual(planProductsMock);
    });

    // UT-007
    it('asks for every plan when no category is given', async () => {
      await service.listPlans();

      expect(products.listPlans).toHaveBeenCalledWith(undefined);
    });
  });

  describe('PlansController.getPlans', () => {
    // UT-008
    it('passes the validated category through to the service', async () => {
      const listPlans = jest.spyOn(service, 'listPlans');

      const result = await controller.getPlans({ category: 'USUARIO' });

      expect(listPlans).toHaveBeenCalledWith('USUARIO');
      expect(result).toEqual(planProductsMock);
    });

    // UT-008
    it('passes undefined when the query carries no category', async () => {
      const listPlans = jest.spyOn(service, 'listPlans');

      await controller.getPlans({});

      expect(listPlans).toHaveBeenCalledWith(undefined);
    });
  });
});
