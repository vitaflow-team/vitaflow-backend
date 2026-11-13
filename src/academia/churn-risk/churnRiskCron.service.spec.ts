import * as Sentry from '@sentry/node';
import { ChurnRiskCronService } from './churnRiskCron.service';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const NOW = new Date('2026-11-15T06:00:00Z');

function makeDeps() {
  return {
    academias: {
      findIdsWithStudents: jest
        .fn()
        .mockResolvedValue(['academia-1', 'academia-2']),
    },
    clients: {
      findProfessionalIdsWithPrivateClients: jest.fn().mockResolvedValue([]),
    },
    users: {
      findProductTypesByIds: jest.fn().mockResolvedValue(new Map()),
    },
    evaluation: {
      evaluateAcademia: jest.fn().mockResolvedValue({
        newEpisodes: 0,
        recoveredEpisodes: 0,
        notificationsSent: 0,
      }),
      evaluateProfessional: jest.fn().mockResolvedValue({ notified: false }),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
}

function makeCron(deps: ReturnType<typeof makeDeps>) {
  return new ChurnRiskCronService(
    deps.academias as never,
    deps.clients as never,
    deps.users as never,
    deps.evaluation as never,
    deps.clock as never,
  );
}

const ZERO_PROFESSIONAL_COUNTS = {
  professionals: 0,
  professionalsNotified: 0,
  professionalsFailed: 0,
};

describe('ChurnRiskCronService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('UT-022 one academia throwing does not prevent the next academia from being evaluated and notified in the same run', async () => {
    const deps = makeDeps();
    deps.evaluation.evaluateAcademia.mockImplementation(
      (academiaId: string) => {
        if (academiaId === 'academia-1') {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({
          newEpisodes: 1,
          recoveredEpisodes: 0,
          notificationsSent: 2,
        });
      },
    );
    const cron = makeCron(deps);

    const summary = await cron.run();

    expect(deps.evaluation.evaluateAcademia).toHaveBeenCalledTimes(2);
    expect(deps.evaluation.evaluateAcademia).toHaveBeenNthCalledWith(
      1,
      'academia-1',
      NOW,
    );
    expect(deps.evaluation.evaluateAcademia).toHaveBeenNthCalledWith(
      2,
      'academia-2',
      NOW,
    );
    expect(summary).toEqual({
      academias: 2,
      notified: 2,
      failed: 1,
      ...ZERO_PROFESSIONAL_COUNTS,
    });
  });

  it('UT-023 a per-academia failure is logged with a structured line and forwarded to Sentry', async () => {
    const deps = makeDeps();
    const error = new Error('boom');
    deps.evaluation.evaluateAcademia.mockImplementation((academiaId: string) =>
      academiaId === 'academia-1'
        ? Promise.reject(error)
        : Promise.resolve({
            newEpisodes: 0,
            recoveredEpisodes: 0,
            notificationsSent: 0,
          }),
    );
    const cron = makeCron(deps);
    const errorSpy = jest.spyOn(
      (cron as unknown as { logger: { error: (msg: string) => void } }).logger,
      'error',
    );

    await cron.run();

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'churn_risk_academia_failed academiaId=academia-1',
      ),
    );
  });

  it('completes a run with zero academias cleanly', async () => {
    const deps = makeDeps();
    deps.academias.findIdsWithStudents.mockResolvedValue([]);
    const cron = makeCron(deps);

    const summary = await cron.run();

    expect(summary).toEqual({
      academias: 0,
      notified: 0,
      failed: 0,
      ...ZERO_PROFESSIONAL_COUNTS,
    });
    expect(deps.evaluation.evaluateAcademia).not.toHaveBeenCalled();
  });

  describe('independent-professional loop (churn-risk-alert-independent)', () => {
    it('UT-031 one professional throwing does not prevent the next professional from being evaluated in the same run; run summary reports the failure count', async () => {
      const deps = makeDeps();
      deps.academias.findIdsWithStudents.mockResolvedValue([]);
      deps.clients.findProfessionalIdsWithPrivateClients.mockResolvedValue([
        'prof-1',
        'prof-2',
        'prof-3',
      ]);
      deps.users.findProductTypesByIds.mockResolvedValue(
        new Map([
          ['prof-1', 'PHYSICAL_EDUCATOR'],
          ['prof-2', 'PHYSICAL_EDUCATOR'],
          ['prof-3', 'NUTRITIONIST'],
        ]),
      );
      deps.evaluation.evaluateProfessional.mockImplementation(
        (professionalId: string) => {
          if (professionalId === 'prof-2') {
            return Promise.reject(new Error('boom'));
          }
          return Promise.resolve({ notified: true });
        },
      );
      const cron = makeCron(deps);

      const summary = await cron.run();

      expect(deps.evaluation.evaluateProfessional).toHaveBeenCalledTimes(3);
      expect(summary).toEqual({
        academias: 0,
        notified: 0,
        failed: 0,
        professionals: 3,
        professionalsNotified: 2,
        professionalsFailed: 1,
      });
    });

    it('a professional failure is forwarded to Sentry and never affects the academia loop', async () => {
      const deps = makeDeps();
      deps.clients.findProfessionalIdsWithPrivateClients.mockResolvedValue([
        'prof-1',
      ]);
      deps.users.findProductTypesByIds.mockResolvedValue(
        new Map([['prof-1', 'PHYSICAL_EDUCATOR']]),
      );
      const error = new Error('boom');
      deps.evaluation.evaluateProfessional.mockRejectedValue(error);
      const cron = makeCron(deps);

      const summary = await cron.run();

      expect(Sentry.captureException).toHaveBeenCalledWith(error);
      expect(summary.academias).toBe(2);
      expect(summary.failed).toBe(0);
    });

    it('skips a professional id whose product type cannot be resolved, without counting it as a failure', async () => {
      const deps = makeDeps();
      deps.clients.findProfessionalIdsWithPrivateClients.mockResolvedValue([
        'prof-1',
      ]);
      deps.users.findProductTypesByIds.mockResolvedValue(new Map());
      const cron = makeCron(deps);

      const summary = await cron.run();

      expect(deps.evaluation.evaluateProfessional).not.toHaveBeenCalled();
      expect(summary.professionalsFailed).toBe(0);
    });
  });
});
