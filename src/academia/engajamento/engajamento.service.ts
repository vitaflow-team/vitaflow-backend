import { PrismaService } from '@/database/prisma.service';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ChurnRiskEpisodeRepository } from '@/repositories/academia/churnRiskEpisode.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Injectable } from '@nestjs/common';
import { ChurnRiskReason } from '@prisma/client';
import {
  computeAtRisk,
  computeRecentFeed,
  computeTodayCount,
  computeWeeklyFrequency,
  resolveLookbackDays,
  WEEKLY_LOOKBACK_DAYS,
  type AtRiskStudent,
  type FeedEntry,
} from './engajamentoAggregation.util';

export interface EngajamentoSummary {
  todayCheckInCount: number;
  weeklyFrequencyAverage: number;
  atRisk: AtRiskStudent[];
  recentFeed: FeedEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EngajamentoService {
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

    return {
      todayCheckInCount: computeTodayCount(checkInFixtures, now),
      weeklyFrequencyAverage: computeWeeklyFrequency(
        checkInFixtures,
        lookbackDays,
        students.length,
      ),
      atRisk,
      recentFeed: computeRecentFeed(checkInFixtures),
    };
  }
}
