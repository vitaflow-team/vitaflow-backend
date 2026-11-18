import { PrismaService } from '@/database/prisma.service';
import { GymRecurringBillingRepository } from './gymRecurringBilling.repository';

function makePrisma() {
  return {
    gymRecurringBilling: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

function makeRepository(prisma: ReturnType<typeof makePrisma>) {
  return new GymRecurringBillingRepository(prisma as unknown as PrismaService);
}

describe('GymRecurringBillingRepository', () => {
  it('UT-070 selects only ACTIVE rows for issuing, so an ENDED row never gets a fee', async () => {
    const prisma = makePrisma();

    await makeRepository(prisma).findIssuable();

    expect(prisma.gymRecurringBilling.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('UT-070 flattens each row into the billing, its student and the gym owner who bills', async () => {
    const prisma = makePrisma();
    prisma.gymRecurringBilling.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        clientId: 'c1',
        client: {
          id: 'c1',
          name: 'Ana',
          academia: { id: 'a1', owner: { id: 'o1', product: null } },
        },
      },
    ]);

    const [row] = await makeRepository(prisma).findIssuable();

    expect(row.billing).toEqual({ id: 'rec-1', clientId: 'c1' });
    expect(row.client).toEqual({ id: 'c1', name: 'Ana' });
    expect(row.owner).toEqual({ id: 'o1', product: null });
  });

  it('UT-071 / UT-072 the last competence counts invoices of every status, so unpaid and canceled fees both move the next month on', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: 'rec-1', last: 202611 },
      { id: 'rec-2', last: 202701 },
    ]);

    const last = await makeRepository(prisma).findLastCompetences();

    expect(last.get('rec-1')).toEqual({ year: 2026, month: 11 });
    expect(last.get('rec-2')).toEqual({ year: 2027, month: 1 });
    const sql = (prisma.$queryRaw.mock.calls[0][0] as { sql: string }).sql;
    expect(sql).toContain(`"status" = 'ACTIVE'`);
    expect(sql).not.toMatch(/i\."status"/);
  });
});
