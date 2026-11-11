import { PrismaService } from '@/database/prisma.service';
import { StudentAccessPlanRepository } from './studentAccessPlan.repository';

const NOW = new Date('2026-11-15T15:00:00Z');

function makePrisma() {
  return {
    client: { findMany: jest.fn() },
    studentAccessPlan: { findMany: jest.fn() },
    checkIn: { findMany: jest.fn() },
  };
}

function makeRepository(prisma: ReturnType<typeof makePrisma>) {
  return new StudentAccessPlanRepository(prisma as unknown as PrismaService);
}

describe('StudentAccessPlanRepository', () => {
  describe('findStatusesByAcademia', () => {
    it('UT-019 classifies NO_PLAN/VALID/EXPIRED/EXHAUSTED the same way StudentAccessPlanService.currentForClient does for each state (parity)', async () => {
      const prisma = makePrisma();
      prisma.client.findMany.mockResolvedValue([
        { id: 'no-plan' },
        { id: 'days-valid' },
        { id: 'days-expired' },
        { id: 'visits-valid' },
        { id: 'visits-exhausted' },
      ]);
      prisma.studentAccessPlan.findMany.mockResolvedValue([
        {
          clientId: 'days-valid',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-12-01T00:00:00Z'),
          assignedAt: new Date('2026-11-01T00:00:00Z'),
        },
        {
          clientId: 'days-expired',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-11-01T00:00:00Z'),
          assignedAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          clientId: 'visits-valid',
          validityType: 'VISITS',
          validityValue: 10,
          expiresAt: null,
          assignedAt: new Date('2026-11-01T00:00:00Z'),
        },
        {
          clientId: 'visits-exhausted',
          validityType: 'VISITS',
          validityValue: 2,
          expiresAt: null,
          assignedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ]);
      // Matches studentAccessPlan.service.spec.ts's own UT-012/UT-013
      // fixtures exactly: 2 distinct BRT days for both VISITS clients
      // (one same-day duplicate for visits-valid).
      prisma.checkIn.findMany.mockResolvedValue([
        {
          clientId: 'visits-valid',
          createdAt: new Date('2026-11-05T13:00:00Z'),
        },
        {
          clientId: 'visits-valid',
          createdAt: new Date('2026-11-06T13:00:00Z'),
        },
        {
          clientId: 'visits-valid',
          createdAt: new Date('2026-11-06T18:00:00Z'),
        },
        {
          clientId: 'visits-exhausted',
          createdAt: new Date('2026-11-05T13:00:00Z'),
        },
        {
          clientId: 'visits-exhausted',
          createdAt: new Date('2026-11-06T13:00:00Z'),
        },
      ]);
      const repository = makeRepository(prisma);

      const statuses = await repository.findStatusesByAcademia(
        'academia-1',
        NOW,
      );

      expect(statuses).toEqual(
        expect.arrayContaining([
          { clientId: 'no-plan', status: 'NO_PLAN' },
          { clientId: 'days-valid', status: 'VALID' },
          { clientId: 'days-expired', status: 'EXPIRED' },
          { clientId: 'visits-valid', status: 'VALID' },
          { clientId: 'visits-exhausted', status: 'EXHAUSTED' },
        ]),
      );
    });

    it('issues a small, fixed number of queries regardless of student count', async () => {
      const prisma = makePrisma();
      prisma.client.findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `client-${i}` })),
      );
      prisma.studentAccessPlan.findMany.mockResolvedValue([]);
      const repository = makeRepository(prisma);

      await repository.findStatusesByAcademia('academia-1', NOW);

      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.studentAccessPlan.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.checkIn.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findHistoryByClient', () => {
    it('UT-015 returns only ARCHIVED rows, joined with the catalog plan’s name', async () => {
      const prisma = makePrisma();
      prisma.studentAccessPlan.findMany.mockResolvedValue([
        {
          id: 'plan-2',
          status: 'ARCHIVED',
          assignedAt: new Date('2026-10-01T00:00:00Z'),
          accessPlan: { name: 'Plano Mensal' },
        },
        {
          id: 'plan-1',
          status: 'ARCHIVED',
          assignedAt: new Date('2026-09-01T00:00:00Z'),
          accessPlan: { name: 'Plano Trimestral' },
        },
      ]);
      const repository = makeRepository(prisma);

      const history = await repository.findHistoryByClient('client-1', 20);

      expect(prisma.studentAccessPlan.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', status: 'ARCHIVED' },
        orderBy: { assignedAt: 'desc' },
        take: 20,
        include: { accessPlan: { select: { name: true } } },
      });
      expect(history).toEqual([
        expect.objectContaining({
          id: 'plan-2',
          accessPlan: { name: 'Plano Mensal' },
        }),
        expect.objectContaining({
          id: 'plan-1',
          accessPlan: { name: 'Plano Trimestral' },
        }),
      ]);
    });

    it('UT-016 caps at the given limit, delegating ordering/truncation to the database', async () => {
      const prisma = makePrisma();
      const rows = Array.from({ length: 20 }, (_, i) => ({
        id: `plan-${i}`,
        status: 'ARCHIVED',
        assignedAt: new Date(2026, 0, 20 - i),
        accessPlan: { name: 'Plano' },
      }));
      prisma.studentAccessPlan.findMany.mockResolvedValue(rows);
      const repository = makeRepository(prisma);

      const history = await repository.findHistoryByClient('client-1', 20);

      expect(prisma.studentAccessPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
      expect(history).toHaveLength(20);
    });
  });
});
