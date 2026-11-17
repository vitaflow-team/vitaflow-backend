import { AuditLogger } from '@/auth/auditLogger.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UploadService } from '@/utils/upload.service';
import { Logger } from '@nestjs/common';
import { ProfileService } from './profile.service';

const timestamp = new Date('2026-11-16T12:00:00.000Z');

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Equipe',
    email: 'equipe@vitaflow.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    product: null,
    userAddresses: null,
    oAuthIdentity: null,
    asaasCustomerId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const freeProduct = { id: 'free-1', name: 'Gratuito', price: 0, type: 'USER' };

describe('ProfileService — unified login account UT-028 and UT-029', () => {
  const users = {
    findUnique: jest.fn(),
    getUserProfile: jest.fn(),
    activateAsCustomer: jest.fn(),
  };
  const upload = { getSignedUrl: jest.fn() };
  const clients = { countByProfessionalId: jest.fn() };
  const products = { findFreeProduct: jest.fn() };
  const audit = { log: jest.fn(), warn: jest.fn() };

  const service = new ProfileService(
    users as unknown as UserRepository,
    upload as unknown as UploadService,
    clients as unknown as ClientsRepository,
    {} as unknown as ProgressPhotosRepository,
    products as unknown as ProductsRepository,
    audit as unknown as AuditLogger,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    clients.countByProfessionalId.mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getProfile', () => {
    it('UT-028: reports googleLinked true with an identity and isBackoffice from the row', async () => {
      users.getUserProfile.mockResolvedValue(
        makeAccount({ oAuthIdentity: { id: 'identity-1' } }),
      );

      const profile = await service.getProfile('user-1');

      expect(profile.googleLinked).toBe(true);
      expect(profile.isBackoffice).toBe(true);
    });

    it('UT-028: reports both false for an ordinary account without a Google link', async () => {
      users.getUserProfile.mockResolvedValue(
        makeAccount({ isBackoffice: false }),
      );

      const profile = await service.getProfile('user-1');

      expect(profile.googleLinked).toBe(false);
      expect(profile.isBackoffice).toBe(false);
    });

    it('UT-028: the identity itself never reaches the response', async () => {
      users.getUserProfile.mockResolvedValue(
        makeAccount({
          oAuthIdentity: { id: 'identity-1', providerAccountId: 'sub-999' },
        }),
      );

      const profile = await service.getProfile('user-1');

      expect(JSON.stringify(profile)).not.toContain('sub-999');
    });
  });

  describe('activateAsCustomer', () => {
    it('UT-029: a plan-less account receives the free product and both consent timestamps', async () => {
      users.findUnique.mockResolvedValue(makeAccount());
      products.findFreeProduct.mockResolvedValue(freeProduct);
      users.getUserProfile.mockResolvedValue(
        makeAccount({ productId: 'free-1', product: freeProduct }),
      );

      const profile = await service.activateAsCustomer('user-1');

      expect(users.activateAsCustomer).toHaveBeenCalledWith('user-1', 'free-1');
      expect(profile.productId).toBe('free-1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'customer_activated',
          userId: 'user-1',
        }),
      );
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain('@');
    });

    it('UT-029: an account that already has a product is 409 already_customer', async () => {
      users.findUnique.mockResolvedValue(makeAccount({ productId: 'free-1' }));

      await expect(service.activateAsCustomer('user-1')).rejects.toMatchObject({
        code: 'already_customer',
        status: 409,
      });

      expect(products.findFreeProduct).not.toHaveBeenCalled();
      expect(users.activateAsCustomer).not.toHaveBeenCalled();
    });

    it('UT-029: a missing free product is 500 and writes nothing', async () => {
      users.findUnique.mockResolvedValue(makeAccount());
      products.findFreeProduct.mockResolvedValue(null);

      await expect(service.activateAsCustomer('user-1')).rejects.toMatchObject({
        status: 500,
      });

      expect(users.activateAsCustomer).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('UT-029: an account that no longer exists is 404', async () => {
      users.findUnique.mockResolvedValue(null);

      await expect(service.activateAsCustomer('ghost')).rejects.toMatchObject({
        status: 404,
      });
      expect(users.activateAsCustomer).not.toHaveBeenCalled();
    });
  });
});
