import { PrismaService } from '@/database/prisma.service';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Injectable } from '@nestjs/common';
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

    const [students, windowed, lastCheckInByClient] = await Promise.all([
      this.clients.findAllGymStudentNames(academiaId),
      this.checkIns.findByAcademiaSince(academiaId, since),
      this.checkIns.findLastCheckInByClient(academiaId),
    ]);

    const checkInFixtures = windowed.map((checkIn) => ({
      clientId: checkIn.clientId,
      createdAt: checkIn.createdAt,
      source: checkIn.source,
      clientName: checkIn.client.name,
      planValidAtCheckIn: checkIn.planValidAtCheckIn,
    }));

    return {
      todayCheckInCount: computeTodayCount(checkInFixtures, now),
      weeklyFrequencyAverage: computeWeeklyFrequency(
        checkInFixtures,
        lookbackDays,
        students.length,
      ),
      atRisk: computeAtRisk(students, lastCheckInByClient, now),
      recentFeed: computeRecentFeed(checkInFixtures),
    };
  }
}
