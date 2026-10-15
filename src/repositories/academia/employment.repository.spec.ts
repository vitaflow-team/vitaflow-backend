import { PrismaService } from '@/database/prisma.service';
import { EmploymentRepository } from './employment.repository';

function makeTx() {
  return {
    employment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'employment-1',
        academiaId: 'academia-1',
        educatorId: 'educator-1',
      }),
    },
    client: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    turma: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('EmploymentRepository.end', () => {
  const prisma = { $transaction: jest.fn() };
  let repository: EmploymentRepository;
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    jest.resetAllMocks();
    tx = makeTx();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : arg,
    );
    repository = new EmploymentRepository(prisma as unknown as PrismaService);
  });

  it('UT-024/UT-025 sets status ENDED and clears professionalId on every Client this educator served at this academia', async () => {
    const result = await repository.end('academia-1', 'employment-1');

    expect(result).toBe(true);
    expect(tx.employment.updateMany).toHaveBeenCalledWith({
      where: { id: 'employment-1', academiaId: 'academia-1', status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: expect.any(Date) },
    });
    expect(tx.client.updateMany).toHaveBeenCalledWith({
      where: { academiaId: 'academia-1', professionalId: 'educator-1' },
      data: { professionalId: null },
    });
  });

  it('UT-026 only touches Client rows at THIS academia — a different academia scope is a separate updateMany call entirely', async () => {
    await repository.end('academia-1', 'employment-1');

    const call = tx.client.updateMany.mock.calls[0][0];
    expect(call.where.academiaId).toBe('academia-1');
  });

  it('UT-027 ending an already-ENDED employment is a no-op: the conditional update matches nothing, nothing else runs', async () => {
    tx.employment.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.end('academia-1', 'employment-1');

    expect(result).toBe(false);
    expect(tx.employment.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.client.updateMany).not.toHaveBeenCalled();
  });

  it('gym-classes UT-025 also clears Turma.professionalId for every turma this educator was responsible for at this academia, same transaction', async () => {
    await repository.end('academia-1', 'employment-1');

    expect(tx.turma.updateMany).toHaveBeenCalledWith({
      where: { academiaId: 'academia-1', professionalId: 'educator-1' },
      data: { professionalId: null },
    });
  });

  it("gym-classes UT-026 ending every employed educator at once clears each one's own turmas independently", async () => {
    await repository.end('academia-1', 'employment-1');

    tx.employment.findUniqueOrThrow.mockResolvedValue({
      id: 'employment-2',
      academiaId: 'academia-1',
      educatorId: 'educator-2',
    });
    await repository.end('academia-1', 'employment-2');

    expect(tx.turma.updateMany).toHaveBeenNthCalledWith(1, {
      where: { academiaId: 'academia-1', professionalId: 'educator-1' },
      data: { professionalId: null },
    });
    expect(tx.turma.updateMany).toHaveBeenNthCalledWith(2, {
      where: { academiaId: 'academia-1', professionalId: 'educator-2' },
      data: { professionalId: null },
    });
  });
});
