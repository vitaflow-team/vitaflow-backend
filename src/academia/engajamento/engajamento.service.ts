import { PrismaService } from '@/database/prisma.service';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Injectable, Logger } from '@nestjs/common';
import { ChurnRiskReason } from '@prisma/client';
import {
  computeAtRisk,
  computeCheckInHeatmap,
  computeMonthOverMonth,
  computeRecentFeed,
  computeTodayCount,
  computeWeeklyFrequency,
  resolveLookbackDays,
  resolvePreviousMonthStart,
  WEEKLY_LOOKBACK_DAYS,
  type AtRiskStudent,
  type CheckInFixture,
  type FeedEntry,
  type HeatmapCell,
  type MonthOverMonth,
} from './engajamentoAggregation.util';

export interface EngajamentoSummary {
  todayCheckInCount: number;
  weeklyFrequencyAverage: number;
  atRisk: AtRiskStudent[];
  recentFeed: FeedEntry[];
  checkInHeatmap: HeatmapCell[];
  monthOverMonth: MonthOverMonth;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EngajamentoService {
  private readonly logger = new Logger(EngajamentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkIns: CheckInRepository,
    private readonly clients: ClientsRepository,
    private readonly churnRiskEpisodes: ChurnRiskEpisodeRepository,
  ) {}

  async summary(academiaId: string, now: Date): Promise<EngajamentoSummary> {
    const academia = await this.prisma.academia.findUnique({
      where: { id: academiaId },
      select: { createdAt: true },
    });
    const lookbackDays = academia
      ? resolveLookbackDays(academia.createdAt, now)
      : WEEKLY_LOOKBACK_DAYS;
    const since = new Date(now.getTime() - lookbackDays * DAY_MS);

    const [students, windowed, lastCheckInByClient, dismissedClientIds] =
      await Promise.all([
        this.clients.findAllGymStudentNames(academiaId),
        this.checkIns.findByAcademiaSince(academiaId, since),
        this.checkIns.findLastCheckInByClient(academiaId),
        this.churnRiskEpisodes.findDismissedClientIds(
          academiaId,
          ChurnRiskReason.CHECK_IN_INACTIVITY,
        ),
      ]);

    const checkInFixtures = windowed.map((checkIn) => ({
      clientId: checkIn.clientId,
      createdAt: checkIn.createdAt,
      source: checkIn.source,
      clientName: checkIn.client.name,
      planValidAtCheckIn: checkIn.planValidAtCheckIn,
    }));

    // Additive filter only (ADR-010): computeAtRisk itself, and every other
    // output below, is untouched — a dismissed-and-not-recovered student
    // simply stops appearing in this one list (UT-020/UT-021).
    const dismissed = new Set(dismissedClientIds);
    const atRisk = computeAtRisk(students, lastCheckInByClient, now).filter(
      (student) => !dismissed.has(student.clientId),
    );

    const { checkInHeatmap, monthOverMonth } =
      await this.computeExtendedWidgets(academiaId, checkInFixtures, now);

    return {
      todayCheckInCount: computeTodayCount(checkInFixtures, now),
      weeklyFrequencyAverage: computeWeeklyFrequency(
        checkInFixtures,
        lookbackDays,
        students.length,
      ),
      atRisk,
      recentFeed: computeRecentFeed(checkInFixtures),
      checkInHeatmap,
      monthOverMonth,
    };
  }

  /**
   * Heatmap + month-over-month degrade to a safe zero-state on failure
   * (UT-048) rather than failing the rest of an already-working summary.
   */
  private async computeExtendedWidgets(
    academiaId: string,
    windowedCheckIns: CheckInFixture[],
    now: Date,
  ): Promise<{
    checkInHeatmap: HeatmapCell[];
    monthOverMonth: MonthOverMonth;
  }> {
    try {
      const monthRows = await this.checkIns.findByAcademiaSince(
        academiaId,
        resolvePreviousMonthStart(now),
      );
      return {
        checkInHeatmap: computeCheckInHeatmap(windowedCheckIns),
        monthOverMonth: computeMonthOverMonth(monthRows, now),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to compute heatmap/monthOverMonth for academia ${academiaId}: ${String(error)}`,
      );
      return {
        checkInHeatmap: computeCheckInHeatmap([]),
        monthOverMonth: {
          currentMonthCount: 0,
          previousMonthCount: null,
          isCurrentMonthPartial: true,
        },
      };
    }
  }
}
