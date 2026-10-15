import { PrismaService } from '@/database/prisma.service';
import { AcademiaProvisioningService } from './academia.service';

function makeTx(userOverrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    users: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'owner-1',
        name: 'Academia Vida Ativa',
        academiaId: null,
        product: { type: 'ACADEMIA' },
        ...userOverrides,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    academia: {
      create: jest.fn().mockResolvedValue({ id: 'academia-new' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'academia-existing' }),
    },
  };
}

describe('AcademiaProvisioningService', () => {
  const prisma = { $transaction: jest.fn() };
  let service: AcademiaProvisioningService;
  let tx: ReturnType<typeof makeTx>;

  function withTx(overrides: Record<string, unknown> = {}) {
    tx = makeTx(overrides);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : arg,
    );
  }

  beforeEach(() => {
    jest.resetAllMocks();
    withTx();
    service = new AcademiaProvisioningService(
      prisma as unknown as PrismaService,
    );
  });

  it('UT-001 creates one Academia row and sets Users.academiaId for a fresh ACADEMIA owner', async () => {
    const result = await service.provisionForOwner('owner-1');

    expect(tx.academia.create).toHaveBeenCalledWith({
      data: { name: 'Academia Vida Ativa' },
    });
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { academiaId: 'academia-new' },
    });
    expect(result).toEqual({ id: 'academia-new' });
  });

  it('UT-002 is idempotent: an already-provisioned owner gets no second Academia row', async () => {
    withTx({ academiaId: 'academia-existing' });

    const result = await service.provisionForOwner('owner-1');

    expect(tx.academia.create).not.toHaveBeenCalled();
    expect(tx.users.update).not.toHaveBeenCalled();
    expect(tx.academia.findUnique).toHaveBeenCalledWith({
      where: { id: 'academia-existing' },
    });
    expect(result).toEqual({ id: 'academia-existing' });
  });

  it('UT-003 is a no-op for a Users row whose product is not ACADEMIA', async () => {
    withTx({ product: { type: 'PHYSICAL_EDUCATOR' } });

    const result = await service.provisionForOwner('owner-1');

    expect(tx.academia.create).not.toHaveBeenCalled();
    expect(tx.users.update).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('is a no-op for a Users row with no product at all', async () => {
    withTx({ product: null });

    const result = await service.provisionForOwner('owner-1');

    expect(result).toBeNull();
  });
});
