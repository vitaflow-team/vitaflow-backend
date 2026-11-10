import { CheckInSource } from '@prisma/client';
import { EngajamentoService } from './engajamento.service';

const NOW = new Date('2026-11-15T12:00:00Z');
const ACADEMIA_CREATED_AT = new Date('2026-01-01T00:00:00Z');

function checkInRow(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    createdAt: NOW,
    source: CheckInSource.SELF,
    planValidAtCheckIn: true,
    client: { name: 'Aluno 1' },
    ...overrides,
  };
}

function makeDeps() {
  return {
    prisma: {
      academia: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ createdAt: ACADEMIA_CREATED_AT }),
      },
    },
    checkIns: {
      findByAcademiaSince: jest.fn().mockResolvedValue([]),
      findLastCheckInByClient: jest.fn().mockResolvedValue(new Map()),
    },
    clients: {
      findAllGymStudentNames: jest.fn().mockResolvedValue([
        { id: 'client-1', name: 'Aluno 1' },
        { id: 'client-2', name: 'Aluno 2' },
      ]),
    },
    churnRiskEpisodes: {
      findDismissedClientIds: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new EngajamentoService(
    deps.prisma as never,
    deps.checkIns as never,
    deps.clients as never,
    deps.churnRiskEpisodes as never,
  );
}

describe('EngajamentoService', () => {
  describe('summary', () => {
    it('UT-020 excludes a student whose CHECK_IN_INACTIVITY episode is dismissed and not yet ended, even though computeAtRisk alone would include them', async () => {
      const deps = makeDeps();
      // Both students are >= 10 days without a check-in, so computeAtRisk
      // alone would flag both.
      deps.churnRiskEpisodes.findDismissedClientIds.mockResolvedValue([
        'client-1',
      ]);
      const service = makeService(deps);

      const result = await service.summary('academia-1', NOW);

      expect(result.atRisk.map((student) => student.clientId)).toEqual([
        'client-2',
      ]);
      expect(
        deps.churnRiskEpisodes.findDismissedClientIds,
      ).toHaveBeenCalledWith('academia-1', 'CHECK_IN_INACTIVITY');
    });

    it('UT-021 (regression) leaves todayCheckInCount, weeklyFrequencyAverage and recentFeed byte-identical to their pre-feature values for the same input, regardless of any dismissed episode', async () => {
      const deps = makeDeps();
      const checkIns = [
        checkInRow({ clientId: 'client-1', createdAt: NOW }),
        checkInRow({ clientId: 'client-2', createdAt: NOW }),
      ];
      deps.checkIns.findByAcademiaSince.mockResolvedValue(checkIns);
      // Old enough (>= RISK_THRESHOLD_DAYS) that computeAtRisk flags both
      // students, independent of the windowed check-ins above (which only
      // feed todayCheckInCount/weeklyFrequencyAverage/recentFeed).
      const oldLastCheckIn = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000);
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([
          ['client-1', oldLastCheckIn],
          ['client-2', oldLastCheckIn],
        ]),
      );

      const withoutDismiss = makeService(deps);
      const baseline = await withoutDismiss.summary('academia-1', NOW);

      deps.churnRiskEpisodes.findDismissedClientIds.mockResolvedValue([
        'client-1',
      ]);
      const withDismiss = makeService(deps);
      const filtered = await withDismiss.summary('academia-1', NOW);

      expect(filtered.todayCheckInCount).toBe(baseline.todayCheckInCount);
      expect(filtered.weeklyFrequencyAverage).toBe(
        baseline.weeklyFrequencyAverage,
      );
      expect(filtered.recentFeed).toEqual(baseline.recentFeed);
      expect(filtered.atRisk).not.toEqual(baseline.atRisk);
    });

    it('an academia with no dismissed episodes returns computeAtRisk unchanged', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.summary('academia-1', NOW);

      expect(result.atRisk.map((student) => student.clientId)).toEqual([
        'client-1',
        'client-2',
      ]);
    });

    it('UT-048 returns a zero-filled heatmap and a null-safe monthOverMonth without any extra data', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.summary('academia-1', NOW);

      expect(result.checkInHeatmap).toHaveLength(168);
      expect(result.checkInHeatmap.every((cell) => cell.count === 0)).toBe(
        true,
      );
      expect(result.monthOverMonth).toEqual({
        currentMonthCount: 0,
        previousMonthCount: null,
        isCurrentMonthPartial: true,
      });
    });

    it('UT-048 degrades checkInHeatmap/monthOverMonth to a safe zero-state, leaving every pre-existing field unaffected, when the extra month-window query fails', async () => {
      const deps = makeDeps();
      const checkIns = [
        checkInRow({ clientId: 'client-1', createdAt: NOW }),
        checkInRow({ clientId: 'client-2', createdAt: NOW }),
      ];
      // First call (the original Promise.all) succeeds; the second call,
      // made only for the new heatmap/monthOverMonth widgets, fails.
      deps.checkIns.findByAcademiaSince
        .mockResolvedValueOnce(checkIns)
        .mockRejectedValueOnce(new Error('db unavailable'));
      const oldLastCheckIn = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000);
      deps.checkIns.findLastCheckInByClient.mockResolvedValue(
        new Map([
          ['client-1', oldLastCheckIn],
          ['client-2', oldLastCheckIn],
        ]),
      );

      const degraded = makeService(deps);
      const result = await degraded.summary('academia-1', NOW);

      // Pre-existing fields: byte-identical to what they'd be without the
      // failure, since they never depend on the second (failing) call.
      expect(result.todayCheckInCount).toBe(2);
      expect(result.atRisk).toHaveLength(2);
      expect(result.recentFeed).toHaveLength(2);

      // New fields degrade to a safe, explicit zero-state instead of
      // throwing or leaving the whole response unresolved.
      expect(result.checkInHeatmap).toHaveLength(168);
      expect(result.checkInHeatmap.every((cell) => cell.count === 0)).toBe(
        true,
      );
      expect(result.monthOverMonth).toEqual({
        currentMonthCount: 0,
        previousMonthCount: null,
        isCurrentMonthPartial: true,
      });
    });
  });
});
