import { PrismaService } from '@/database/prisma.service';
import { BillingAccountStatus } from '@prisma/client';
import { BillingAccountRepository } from './billingAccount.repository';

describe('BillingAccountRepository', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const update = jest.fn();

  const prisma = {
    billingAccount: { findFirst, findMany, update },
    invoice: { count },
  } as unknown as PrismaService;

  const repository = new BillingAccountRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findByWebhookTokenHash looks up any status that still holds a key', async () => {
    findFirst.mockResolvedValue(null);
    await repository.findByWebhookTokenHash('hash-1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { webhookTokenHash: 'hash-1', apiKeyEncrypted: { not: null } },
    });
  });

  it('findAllWithKey scopes to every account still holding a key, any status', async () => {
    findMany.mockResolvedValue([]);
    await repository.findAllWithKey();
    expect(findMany).toHaveBeenCalledWith({
      where: { apiKeyEncrypted: { not: null } },
    });
  });

  describe('purgeReplacedWithoutOpenInvoices (UT-092)', () => {
    it('deletes the key of a replaced account that has no open invoices', async () => {
      findMany.mockResolvedValue([{ id: 'replaced-1' }]);
      count.mockResolvedValue(0);

      const purged = await repository.purgeReplacedWithoutOpenInvoices();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          status: BillingAccountStatus.REPLACED,
          apiKeyEncrypted: { not: null },
        },
        select: { id: true },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'replaced-1' },
        data: { apiKeyEncrypted: null, webhookId: null },
      });
      expect(purged).toEqual(['replaced-1']);
    });

    it('keeps the key while any open invoice remains', async () => {
      findMany.mockResolvedValue([{ id: 'replaced-1' }]);
      count.mockResolvedValue(1);

      const purged = await repository.purgeReplacedWithoutOpenInvoices();

      expect(update).not.toHaveBeenCalled();
      expect(purged).toEqual([]);
    });
  });
});
