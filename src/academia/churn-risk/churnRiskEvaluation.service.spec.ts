import { ChurnRiskEvaluationService } from './churnRiskEvaluation.service';

const NOW = new Date('2026-11-15T12:00:00Z');
const BASELINED_AT = new Date('2026-01-01T00:00:00Z');
const OLD_CHECK_IN = new Date('2026-11-01T00:00:00Z'); // 14 days before NOW
const RECENT_CHECK_IN = new Date('2026-11-14T12:00:00Z'); // 1 day before NOW

function student(id: string, name = `Aluno ${id}`) {
  return { id, name };
}

function openEpisode(
  clientId: string,
  reason: 'CHECK_IN_INACTIVITY' | 'ACCESS_PLAN_LAPSED',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `episode-${clientId}-${reason}`,
    clientId,
    reason,
    startedAt: OLD_CHECK_IN,
    notifiedAt: OLD_CHECK_IN,
    dismissedAt: null,
    endedAt: null,
    createdAt: OLD_CHECK_IN,
    ...overrides,
  };
}

function makeDeps() {
  return {
    episodes: {
      findOpenByAcademia: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      dismissOpenForClient: jest.fn().mockResolvedValue(0),
    },
    academias: {
      findChurnRiskBaselineAt: jest.fn().mockResolvedValue(BASELINED_AT),
      markChurnRiskBaselined: jest.fn().mockResolvedValue(undefined),
    },
    checkIns: {
      findLastCheckInByClient: jest.fn().mockResolvedValue(new Map()),
    },
    plans: {
      findStatusesByAcademia: jest.fn().mockResolvedValue([]),
    },
    clients: {
      findAllGymStudentNames: jest.fn().mockResolvedValue([student('s1')]),
    },
    users: {
      findUnique: jest.fn().mockResolvedValue({ id: 'owner-1' }),
    },
    notifications: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new ChurnRiskEvaluationService(
    deps.episodes as never,
    deps.academias as never,
    deps.checkIns as never,
    deps.plans as never,
    deps.clients as never,
    deps.users as never,
    deps.notifications as never,
  );
}

describe('ChurnRiskEvaluationService', () => {
  describe('evaluateAcademia', () => {
    it('UT-001 a student with no check-in in >=10 days and no open episode creates one (notifiedAt set) and notifies once', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(deps.notifications.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        newEpisodes: 1,
        recoveredEpisodes: 0,
        notificationsSent: 1,
      });
    });

    it('UT-002 a student who has never checked in is treated the same as a newly-at-risk student', async () => {
      const deps = makeDeps();
      // No entry at all for 's1' in the map — "never checked in".
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(result.notificationsSent).toBe(1);
    });

    it("UT-003 the notification's message identifies the student and its link leads to the engajamento dashboard", async () => {
      const deps = makeDeps();
      deps.clients.findAllGymStudentNames.mockResolvedValue([
        student('s1', 'Maria Silva'),
      ]);
      const service = makeService(deps);

      await service.evaluateAcademia('academia-1', NOW);

      const [, , message, link] = deps.notifications.create.mock.calls[0];
      expect(message).toContain('Maria Silva');
      expect(link).toContain('academia-engajamento');
    });

    it('UT-004 a plan newly EXPIRED creates an ACCESS_PLAN_LAPSED episode and notifies', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'EXPIRED' },
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'ACCESS_PLAN_LAPSED',
        NOW,
      );
      expect(result.notificationsSent).toBe(1);
    });

    it('UT-005 a plan newly EXHAUSTED creates an ACCESS_PLAN_LAPSED episode and notifies', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'EXHAUSTED' },
      ]);
      const service = makeService(deps);

      await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'ACCESS_PLAN_LAPSED',
        NOW,
      );
    });

    it('UT-006 a NO_PLAN student is never flagged for the plan reason', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'NO_PLAN' },
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).not.toHaveBeenCalled();
      expect(result.notificationsSent).toBe(0);
    });

    it('UT-007 a plan renewed (VALID) before ever expiring is never flagged for the plan reason', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'VALID' },
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).not.toHaveBeenCalled();
      expect(result.notificationsSent).toBe(0);
    });

    it('UT-008 a student newly matching BOTH reasons in the same run gets exactly one combined notification, not two', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'EXPIRED' },
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.notifications.create).toHaveBeenCalledTimes(1);
      expect(deps.episodes.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        newEpisodes: 2,
        recoveredEpisodes: 0,
        notificationsSent: 1,
      });
    });

    it('UT-009 an already-open, already-notified episode generates no additional notification while the condition persists', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      deps.episodes.findOpenByAcademia.mockResolvedValue([
        openEpisode('s1', 'CHECK_IN_INACTIVITY'),
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).not.toHaveBeenCalled();
      expect(deps.notifications.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        newEpisodes: 0,
        recoveredEpisodes: 0,
        notificationsSent: 0,
      });
    });

    it('UT-010 one reason already notified, the other newly triggering, notifies only for the new reason', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      deps.plans.findStatusesByAcademia.mockResolvedValue([
        { clientId: 's1', status: 'EXPIRED' },
      ]);
      deps.episodes.findOpenByAcademia.mockResolvedValue([
        openEpisode('s1', 'CHECK_IN_INACTIVITY'),
      ]);
      const service = makeService(deps);

      await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledTimes(1);
      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'ACCESS_PLAN_LAPSED',
        NOW,
      );
      expect(deps.notifications.create).toHaveBeenCalledTimes(1);
      const [, , message] = deps.notifications.create.mock.calls[0];
      expect(message).not.toContain('check-in');
    });

    it('UT-011 running the evaluation twice in immediate succession with no state change produces no duplicate notification or episode', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      const service = makeService(deps);

      await service.evaluateAcademia('academia-1', NOW);
      // Second run sees the episode the first run just created as open.
      deps.episodes.findOpenByAcademia.mockResolvedValue([
        openEpisode('s1', 'CHECK_IN_INACTIVITY'),
      ]);
      await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledTimes(1);
      expect(deps.notifications.create).toHaveBeenCalledTimes(1);
    });

    it('UT-012 an episode that ended (recovered) and later re-triggers the same reason creates a new episode and a new notification', async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      // No currently-open episode — the prior one already ended on an
      // earlier run; this run's relapse is a genuinely new episode.
      deps.episodes.findOpenByAcademia.mockResolvedValue([]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(result.notificationsSent).toBe(1);
    });

    it('a student no longer matching a reason with an open episode for it ends that episode (recovery)', async () => {
      const deps = makeDeps();
      // Recent check-in now — no longer at risk by that reason.
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      deps.episodes.findOpenByAcademia.mockResolvedValue([
        openEpisode('s1', 'CHECK_IN_INACTIVITY'),
      ]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.end).toHaveBeenCalledWith(
        'episode-s1-CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(result.recoveredEpisodes).toBe(1);
    });

    it("UT-014 a dismissed-then-recovered-then-relapsed student is notified normally for the new episode — dismissal doesn't carry forward", async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      // The previous episode was dismissed AND has since ended (recovered),
      // so findOpenByAcademia (endedAt null only) no longer returns it.
      deps.episodes.findOpenByAcademia.mockResolvedValue([]);
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(result.notificationsSent).toBe(1);
    });

    it("UT-016 an academia's first-ever evaluation creates episodes with notifiedAt set but sends zero notifications, and sets churnRiskBaselineAt", async () => {
      const deps = makeDeps();
      deps.academias.findChurnRiskBaselineAt.mockResolvedValue(null);
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(deps.notifications.create).not.toHaveBeenCalled();
      expect(deps.academias.markChurnRiskBaselined).toHaveBeenCalledWith(
        'academia-1',
        NOW,
      );
      expect(result.notificationsSent).toBe(0);
    });

    it('UT-016b sets churnRiskBaselineAt on the first-ever run even when zero students match', async () => {
      const deps = makeDeps();
      deps.academias.findChurnRiskBaselineAt.mockResolvedValue(null);
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', RECENT_CHECK_IN]]),
      );
      const service = makeService(deps);

      await service.evaluateAcademia('academia-1', NOW);

      expect(deps.academias.markChurnRiskBaselined).toHaveBeenCalledWith(
        'academia-1',
        NOW,
      );
    });

    it('UT-018 a second academia is baselined independently of another academia already having been evaluated', async () => {
      const deps = makeDeps();
      deps.academias.findChurnRiskBaselineAt.mockResolvedValue(null);
      const service = makeService(deps);

      await service.evaluateAcademia('academia-2', NOW);

      expect(deps.academias.findChurnRiskBaselineAt).toHaveBeenCalledWith(
        'academia-2',
      );
      expect(deps.academias.markChurnRiskBaselined).toHaveBeenCalledWith(
        'academia-2',
        NOW,
      );
    });

    it("a notification failure is logged and swallowed, never blocking that academia's episode bookkeeping", async () => {
      const deps = makeDeps();
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([['s1', OLD_CHECK_IN]]),
      );
      deps.notifications.create.mockRejectedValue(new Error('smtp down'));
      const service = makeService(deps);

      const result = await service.evaluateAcademia('academia-1', NOW);

      expect(deps.episodes.create).toHaveBeenCalledWith(
        's1',
        'CHECK_IN_INACTIVITY',
        NOW,
      );
      expect(result.newEpisodes).toBe(1);
    });
  });

  describe('dismissForClient', () => {
    it('UT-013 dismissing a client with open episodes for both reasons closes both in one action', async () => {
      const deps = makeDeps();
      deps.episodes.dismissOpenForClient.mockResolvedValue(2);
      const service = makeService(deps);

      const result = await service.dismissForClient('client-1', NOW);

      expect(deps.episodes.dismissOpenForClient).toHaveBeenCalledWith(
        'client-1',
        NOW,
      );
      expect(result).toEqual({ dismissed: 2 });
    });

    it('UT-015 dismissing a client with no currently-open episode is a no-op, not an error', async () => {
      const deps = makeDeps();
      deps.episodes.dismissOpenForClient.mockResolvedValue(0);
      const service = makeService(deps);

      const result = await service.dismissForClient('client-1', NOW);

      expect(result).toEqual({ dismissed: 0 });
    });
  });
});
