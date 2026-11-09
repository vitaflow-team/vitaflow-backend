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
    evaluation: {
      evaluateAcademia: jest.fn().mockResolvedValue({
        newEpisodes: 0,
        recoveredEpisodes: 0,
        notificationsSent: 0,
      }),
    },
    clock: { now: jest.fn().mockReturnValue(NOW) },
  };
}

function makeCron(deps: ReturnType<typeof makeDeps>) {
  return new ChurnRiskCronService(
    deps.academias as never,
    deps.evaluation as never,
    deps.clock as never,
  );
}

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
    expect(summary).toEqual({ academias: 2, notified: 2, failed: 1 });
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

    expect(summary).toEqual({ academias: 0, notified: 0, failed: 0 });
    expect(deps.evaluation.evaluateAcademia).not.toHaveBeenCalled();
  });
});
