import { NutritionistDashboardService } from './nutritionistDashboard.service';

function buildService(overrides: {
  clients?: Record<string, jest.Mock>;
  meals?: Record<string, jest.Mock>;
  waterLogs?: Record<string, jest.Mock>;
  mealPlans?: Record<string, jest.Mock>;
  measurementRecords?: Record<string, jest.Mock>;
  billingAccounts?: Record<string, jest.Mock>;
  invoices?: Record<string, jest.Mock>;
  churnRiskEpisodes?: Record<string, jest.Mock>;
}) {
  const clients = {
    getAllByProfessionalId: jest.fn().mockResolvedValue([]),
    ...overrides.clients,
  };
  const meals = {
    findByUserForProfessional: jest.fn().mockResolvedValue([]),
    ...overrides.meals,
  };
  const waterLogs = {
    findByUserForProfessional: jest.fn().mockResolvedValue([]),
    ...overrides.waterLogs,
  };
  const mealPlans = {
    findLatestPublished: jest.fn().mockResolvedValue(null),
    ...overrides.mealPlans,
  };
  const measurementRecords = {
    aggregateByClientAndMonth: jest.fn().mockResolvedValue([]),
    ...overrides.measurementRecords,
  };
  const billingAccounts = {
    findActiveByUser: jest.fn().mockResolvedValue(null),
    ...overrides.billingAccounts,
  };
  const invoices = {
    findOpenByAccount: jest.fn().mockResolvedValue([]),
    ...overrides.invoices,
  };
  const churnRiskEpisodes = {
    findDismissedClientIdsByIds: jest.fn().mockResolvedValue(new Set()),
    ...overrides.churnRiskEpisodes,
  };
  const service = new NutritionistDashboardService(
    clients as never,
    meals as never,
    waterLogs as never,
    mealPlans as never,
    measurementRecords as never,
    billingAccounts as never,
    invoices as never,
    churnRiskEpisodes as never,
  );
  return {
    service,
    clients,
    meals,
    waterLogs,
    mealPlans,
    measurementRecords,
    billingAccounts,
    invoices,
    churnRiskEpisodes,
  };
}

describe('NutritionistDashboardService.getDashboard', () => {
  const NOW = new Date('2026-11-15T12:00:00Z');

  it('UT-047 excludes a patient whose meal-plan lookup fails (logged, degraded) instead of failing the whole response', () => {
    const okPatient = {
      id: 'p1',
      name: 'OK Patient',
      userId: 'u1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const failingPatient = {
      id: 'p2',
      name: 'Failing Patient',
      userId: 'u2',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { service, mealPlans } = buildService({
      clients: {
        getAllByProfessionalId: jest
          .fn()
          .mockResolvedValue([okPatient, failingPatient]),
      },
      mealPlans: {
        findLatestPublished: jest.fn((clientId: string) => {
          if (clientId === failingPatient.id) {
            return Promise.reject(new Error('db timeout'));
          }
          return Promise.resolve({
            publishedAt: new Date('2026-11-01T00:00:00Z'),
          });
        }),
      },
    });

    return service.getDashboard('nutri-1', NOW).then((result) => {
      expect(mealPlans.findLatestPublished).toHaveBeenCalledWith(okPatient.id);
      const allEntries = [
        ...result.adherenceBuckets.compliant,
        ...result.adherenceBuckets.struggling,
        ...result.adherenceBuckets.nonAdherent,
        ...result.adherenceBuckets.noDataYet,
      ];
      expect(allEntries).toHaveLength(2);
      expect(allEntries.find((e) => e.clientId === failingPatient.id)).toEqual(
        expect.objectContaining({ loggedDayRatio: null }),
      );
    });
  });

  it('excludes an unlinked patient (Client.userId null) from the weight-evolution aggregate query', async () => {
    const unlinkedPatient = {
      id: 'p1',
      name: 'Unlinked',
      userId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { service, measurementRecords } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue([unlinkedPatient]),
      },
    });

    await service.getDashboard('nutri-1', NOW);

    expect(measurementRecords.aggregateByClientAndMonth).not.toHaveBeenCalled();
  });

  it('UT-032 excludes a patient with a dismissed, still-matching no-diary-entry episode from noDiaryEntryAlerts', async () => {
    const stalePatient = {
      id: 'p1',
      name: 'Stale Patient',
      userId: 'u1',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    };
    const { service } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue([stalePatient]),
      },
      churnRiskEpisodes: {
        findDismissedClientIdsByIds: jest
          .fn()
          .mockImplementation((_ids: string[], reason: string) =>
            Promise.resolve(
              reason === 'NO_DIARY_ENTRY' ? new Set(['p1']) : new Set(),
            ),
          ),
      },
    });

    const result = await service.getDashboard('nutri-1', NOW);

    expect(result.noDiaryEntryAlerts).toEqual([]);
  });

  it('surfaces an overdue-payment alert when billing is connected and the patient has an overdue invoice', async () => {
    const patient = {
      id: 'p1',
      name: 'P1',
      userId: 'u1',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    };
    const { service } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue([patient]),
      },
      billingAccounts: {
        findActiveByUser: jest.fn().mockResolvedValue({ id: 'account-1' }),
      },
      invoices: {
        findOpenByAccount: jest
          .fn()
          .mockResolvedValue([{ clientId: 'p1', status: 'OVERDUE' }]),
      },
    });

    const result = await service.getDashboard('nutri-1', NOW);

    expect(result.overduePaymentAlerts).toEqual([
      { clientId: 'p1', clientName: 'P1' },
    ]);
  });

  it('never surfaces an overdue-payment alert when billing is not connected', async () => {
    const patient = {
      id: 'p1',
      name: 'P1',
      userId: 'u1',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    };
    const { service } = buildService({
      clients: {
        getAllByProfessionalId: jest.fn().mockResolvedValue([patient]),
      },
    });

    const result = await service.getDashboard('nutri-1', NOW);

    expect(result.overduePaymentAlerts).toEqual([]);
  });
});
