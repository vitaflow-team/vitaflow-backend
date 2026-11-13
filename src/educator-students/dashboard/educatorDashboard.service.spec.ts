import { InvoiceStatus } from '@prisma/client';
import { EducatorDashboardService } from './educatorDashboard.service';

function buildService(overrides: {
  clients?: Record<string, jest.Mock>;
  fixedTimes?: Record<string, jest.Mock>;
  billingAccounts?: Record<string, jest.Mock>;
  invoices?: Record<string, jest.Mock>;
  churnRiskEpisodes?: Record<string, jest.Mock>;
}) {
  const clients = {
    getAllByProfessionalId: jest.fn().mockResolvedValue([]),
    getClientById: jest.fn().mockResolvedValue(null),
    ...overrides.clients,
  };
  const fixedTimes = {
    findLatestNonCanceledByClient: jest.fn().mockResolvedValue(new Map()),
    ...overrides.fixedTimes,
  };
  const billingAccounts = {
    findActiveByUser: jest.fn().mockResolvedValue(null),
    ...overrides.billingAccounts,
  };
  const invoices = {
    findOpenByAccount: jest.fn().mockResolvedValue([]),
    sumAmountByStudentAndMonth: jest.fn().mockResolvedValue([]),
    ...overrides.invoices,
  };
  const churnRiskEpisodes = {
    findDismissedClientIdsByIds: jest.fn().mockResolvedValue(new Set()),
    ...overrides.churnRiskEpisodes,
  };
  const service = new EducatorDashboardService(
    clients as never,
    fixedTimes as never,
    billingAccounts as never,
    invoices as never,
    churnRiskEpisodes as never,
  );
  return {
    service,
    clients,
    fixedTimes,
    billingAccounts,
    invoices,
    churnRiskEpisodes,
  };
}

describe('EducatorDashboardService.getDashboard', () => {
  const NOW = new Date('2026-11-15T12:00:00Z');

  it('UT-046 degrades to billingAvailable false (empty revenue, no overdue flags) when the billing lookup throws, but still returns counters and risk ranking', async () => {
    const students = [
      {
        id: 's1',
        name: 'Student 1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const { service, billingAccounts } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue(students),
        getClientById: jest.fn().mockResolvedValue(null),
      },
      fixedTimes: {
        findLatestNonCanceledByClient: jest
          .fn()
          .mockResolvedValue(
            new Map([['s1', new Date('2026-10-01T00:00:00Z')]]),
          ),
      },
      billingAccounts: {
        findActiveByUser: jest
          .fn()
          .mockRejectedValue(new Error('gateway down')),
      },
    });

    const result = await service.getDashboard('educator-1', NOW);

    expect(billingAccounts.findActiveByUser).toHaveBeenCalledWith('educator-1');
    expect(result.revenueByStudentMonth).toEqual([]);
    expect(result.counters).toEqual({
      activeCount: 0,
      inactiveCount: 1,
      totalCount: 1,
    });
    expect(result.riskRanking).toEqual([
      expect.objectContaining({
        clientId: 's1',
        reasons: ['NO_CONTACT'],
        billingAvailable: false,
      }),
    ]);
  });

  it('builds the revenue series from the billing account when connected, looking up names for clients outside the current portfolio', async () => {
    const students = [
      {
        id: 's1',
        name: 'Student 1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const { service, invoices, clients } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue(students),
        getClientById: jest
          .fn()
          .mockResolvedValue({ id: 's2', name: 'Former Student' }),
      },
      billingAccounts: {
        findActiveByUser: jest.fn().mockResolvedValue({ id: 'account-1' }),
      },
      invoices: {
        findOpenByAccount: jest
          .fn()
          .mockResolvedValue([
            { clientId: 's1', status: InvoiceStatus.OVERDUE },
          ]),
        sumAmountByStudentAndMonth: jest.fn().mockResolvedValue([
          { clientId: 's1', year: 2026, month: 11, amountCents: 10_000 },
          { clientId: 's2', year: 2026, month: 9, amountCents: 5_000 },
        ]),
      },
    });

    const result = await service.getDashboard('educator-1', NOW);

    expect(clients.getClientById).toHaveBeenCalledWith('s2');
    expect(result.revenueByStudentMonth).toEqual([
      {
        clientId: 's1',
        clientName: 'Student 1',
        year: 2026,
        month: 11,
        amountCents: 10_000,
      },
      {
        clientId: 's2',
        clientName: 'Former Student',
        year: 2026,
        month: 9,
        amountCents: 5_000,
      },
    ]);
    expect(
      result.riskRanking.find((entry) => entry.clientId === 's1')?.reasons,
    ).toContain('OVERDUE_PAYMENT');
    expect(invoices.sumAmountByStudentAndMonth).toHaveBeenCalledWith(
      'account-1',
    );
  });

  it('UT-032 excludes a student whose only current reason is dismissed, but keeps one who also has a reason that is still live', async () => {
    const students = [
      {
        id: 's1',
        name: 'Dismissed only',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 's2',
        name: 'Also overdue',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const { service } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue(students),
      },
      fixedTimes: {
        // Both never had a session → both flagged NO_CONTACT.
        findLatestNonCanceledByClient: jest.fn().mockResolvedValue(new Map()),
      },
      billingAccounts: {
        findActiveByUser: jest.fn().mockResolvedValue({ id: 'account-1' }),
      },
      invoices: {
        // s2 also has an overdue invoice — a second, still-live reason.
        findOpenByAccount: jest
          .fn()
          .mockResolvedValue([{ clientId: 's2', status: 'OVERDUE' }]),
      },
      churnRiskEpisodes: {
        // NO_CONTACT is dismissed for both; OVERDUE_PAYMENT is dismissed
        // for neither.
        findDismissedClientIdsByIds: jest
          .fn()
          .mockImplementation((_ids: string[], reason: string) =>
            Promise.resolve(
              reason === 'NO_CONTACT' ? new Set(['s1', 's2']) : new Set(),
            ),
          ),
      },
    });

    const result = await service.getDashboard('educator-1', NOW);

    expect(result.riskRanking.map((entry) => entry.clientId)).toEqual(['s2']);
    expect(result.noContactAlerts).toEqual([]);
  });
});
