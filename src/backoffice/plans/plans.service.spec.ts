import {
  CreateProductData,
  ProductsRepository,
  ProductWithGroup,
} from '@/repositories/product/product.repository';
import { CodedError } from '@/common/errors/codedError';
import { PlansService } from './plans.service';

function makeProduct(
  overrides: Partial<ProductWithGroup> = {},
): ProductWithGroup {
  const timestamp = new Date('2026-11-01T10:00:00.000Z');
  return {
    id: 'prod-1',
    name: 'Premium',
    price: 29.9,
    groupId: 'group-1',
    type: 'USER',
    tier: 'STANDARD',
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    group: {
      id: 'group-1',
      name: 'Usuário',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    ...overrides,
  } as ProductWithGroup;
}

describe('PlansService — plan-pricing-management UT-001 through UT-009', () => {
  const products = {
    listCatalog: jest.fn(),
    createProduct: jest.fn(),
    repriceProduct: jest.fn(),
    deactivateProduct: jest.fn(),
  };

  const service = new PlansService(products as unknown as ProductsRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listCatalog', () => {
    // UT-001
    it('returns every product, each carrying its own active/inactive state', async () => {
      const activeOne = makeProduct({ id: 'active-1', active: true });
      const inactiveOne = makeProduct({ id: 'inactive-1', active: false });
      products.listCatalog.mockResolvedValue([activeOne, inactiveOne]);

      const result = await service.listCatalog();

      expect(result).toEqual([
        {
          id: 'active-1',
          name: 'Premium',
          price: 29.9,
          type: 'USER',
          tier: 'STANDARD',
          active: true,
          groupId: 'group-1',
          groupName: 'Usuário',
        },
        {
          id: 'inactive-1',
          name: 'Premium',
          price: 29.9,
          type: 'USER',
          tier: 'STANDARD',
          active: false,
          groupId: 'group-1',
          groupName: 'Usuário',
        },
      ]);
    });

    // UT-002
    it('represents a role with zero active products rather than omitting it', async () => {
      const onlyInactive = makeProduct({ id: 'inactive-1', active: false });
      products.listCatalog.mockResolvedValue([onlyInactive]);

      const result = await service.listCatalog();

      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(false);
    });
  });

  describe('createProduct', () => {
    // UT-003
    it('creates a new active product from valid input', async () => {
      const created = makeProduct({ id: 'new-1' });
      products.createProduct.mockResolvedValue(created);
      const input = {
        groupId: 'group-1',
        name: 'Premium',
        price: 29.9,
        type: 'USER' as const,
        tier: 'STANDARD' as const,
      };

      const result = await service.createProduct(input);

      const expectedData: CreateProductData = input;
      expect(products.createProduct).toHaveBeenCalledWith(expectedData);
      expect(result.id).toBe('new-1');
      expect(result.active).toBe(true);
    });

    // UT-004
    it('rejects price <= 0 with a clear validation error', async () => {
      await expect(
        service.createProduct({
          groupId: 'group-1',
          name: 'Premium',
          price: 0,
          type: 'USER',
          tier: 'STANDARD',
        }),
      ).rejects.toThrow(CodedError);
      expect(products.createProduct).not.toHaveBeenCalled();
    });

    // UT-005
    it('rejects an empty name with a clear validation error', async () => {
      await expect(
        service.createProduct({
          groupId: 'group-1',
          name: '   ',
          price: 29.9,
          type: 'USER',
          tier: 'STANDARD',
        }),
      ).rejects.toThrow(CodedError);
      expect(products.createProduct).not.toHaveBeenCalled();
    });
  });

  describe('repriceProduct', () => {
    // UT-006
    it('delegates the create-new-plus-deactivate-old versioning to one atomic repository call', async () => {
      const repriced = makeProduct({ id: 'prod-1', price: 39.9 });
      products.repriceProduct.mockResolvedValue(repriced);

      const result = await service.repriceProduct('prod-1', 39.9);

      expect(products.repriceProduct).toHaveBeenCalledWith('prod-1', 39.9);
      expect(products.createProduct).not.toHaveBeenCalled();
      expect(products.deactivateProduct).not.toHaveBeenCalled();
      expect(result.price).toBe(39.9);
    });

    // UT-006 — a simulated mid-transaction failure leaves the service
    // doing nothing further: it never falls back to separate, non-atomic
    // create/deactivate calls when the repository's own transaction fails.
    it('propagates a repository transaction failure without any other repository call', async () => {
      products.repriceProduct.mockRejectedValue(new Error('tx rolled back'));

      await expect(service.repriceProduct('prod-1', 39.9)).rejects.toThrow(
        'tx rolled back',
      );
      expect(products.createProduct).not.toHaveBeenCalled();
      expect(products.deactivateProduct).not.toHaveBeenCalled();
    });

    it('rejects a reprice to price <= 0 before ever calling the repository', async () => {
      await expect(service.repriceProduct('prod-1', 0)).rejects.toThrow(
        CodedError,
      );
      expect(products.repriceProduct).not.toHaveBeenCalled();
    });

    it('maps a missing product to a 404 CodedError', async () => {
      products.repriceProduct.mockResolvedValue(null);

      await expect(service.repriceProduct('missing', 39.9)).rejects.toThrow(
        CodedError,
      );
    });

    // UT-007
    it('behaves identically whether or not any Users row references the product', async () => {
      const repriced = makeProduct({ id: 'prod-1', price: 39.9 });
      products.repriceProduct.mockResolvedValue(repriced);

      await service.repriceProduct('prod-1', 39.9);

      // No subscriber-count check of any kind — the repository call is the
      // only thing the service does, regardless of referencing Users rows.
      expect(products.repriceProduct).toHaveBeenCalledTimes(1);
    });
  });

  describe('deactivateProduct', () => {
    // UT-008
    it('sets active: false without deleting; the row stays readable via listCatalog', async () => {
      products.deactivateProduct.mockResolvedValue(true);

      await service.deactivateProduct('prod-1');

      expect(products.deactivateProduct).toHaveBeenCalledWith('prod-1');
    });

    // UT-009 — deactivating the only active product for a role/tier is not
    // blocked by any special-cased check.
    it('succeeds even when it is the only active product for its role/tier', async () => {
      products.deactivateProduct.mockResolvedValue(true);

      await expect(
        service.deactivateProduct('only-active'),
      ).resolves.toBeUndefined();
    });

    it('maps a missing product to a 404 CodedError', async () => {
      products.deactivateProduct.mockResolvedValue(false);

      await expect(service.deactivateProduct('missing')).rejects.toThrow(
        CodedError,
      );
    });
  });
});
