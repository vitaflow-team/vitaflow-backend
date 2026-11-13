import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ChurnRiskEpisode, ChurnRiskReason } from '@prisma/client';

@Injectable()
export class ChurnRiskEpisodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every currently-open (endedAt null) episode across this academia's
   * students — the evaluation service's diffing base (ADR-002/ADR-009). */
  async findOpenByAcademia(academiaId: string): Promise<ChurnRiskEpisode[]> {
    return await this.prisma.churnRiskEpisode.findMany({
      where: { endedAt: null, client: { academiaId } },
    });
  }

  async create(
    clientId: string,
    reason: ChurnRiskReason,
    notifiedAt: Date | null,
  ): Promise<ChurnRiskEpisode> {
    return await this.prisma.churnRiskEpisode.create({
      data: { clientId, reason, notifiedAt },
    });
  }

  async end(id: string, endedAt: Date): Promise<void> {
    await this.prisma.churnRiskEpisode.update({
      where: { id },
      data: { endedAt },
    });
  }

  // Closes every currently-open episode for this client in one statement,
  // regardless of reason (ADR-009) — a client with nothing open is a valid,
  // expected no-op (0 rows affected, never an error — US-005.EC-1).
  async dismissOpenForClient(
    clientId: string,
    dismissedAt: Date,
  ): Promise<number> {
    const { count } = await this.prisma.churnRiskEpisode.updateMany({
      where: { clientId, endedAt: null },
      data: { dismissedAt },
    });
    return count;
  }

  // The dashboard filter's own read (ADR-010): clients whose episode for
  // `reason` is dismissed but not yet ended (recovered) at this academia.
  async findDismissedClientIds(
    academiaId: string,
    reason: ChurnRiskReason,
  ): Promise<string[]> {
    const rows = await this.prisma.churnRiskEpisode.findMany({
      where: {
        reason,
        dismissedAt: { not: null },
        endedAt: null,
        client: { academiaId },
      },
      select: { clientId: true },
    });
    return rows.map((row) => row.clientId);
  }

  // Generic, client-id-scoped counterpart to findOpenByAcademia, for
  // ownership shapes that aren't academia-based (churn-risk-alert-
  // independent ADR-006) — the existing academia-shaped method above stays
  // untouched; the evaluation caller computes clientIds itself.
  async findOpenByClientIds(clientIds: string[]): Promise<ChurnRiskEpisode[]> {
    if (clientIds.length === 0) return [];
    return await this.prisma.churnRiskEpisode.findMany({
      where: { endedAt: null, clientId: { in: clientIds } },
    });
  }

  // Generic, client-id-scoped counterpart to findDismissedClientIds, for the
  // same reason as findOpenByClientIds above.
  async findDismissedClientIdsByIds(
    clientIds: string[],
    reason: ChurnRiskReason,
  ): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set();
    const rows = await this.prisma.churnRiskEpisode.findMany({
      where: {
        reason,
        dismissedAt: { not: null },
        endedAt: null,
        clientId: { in: clientIds },
      },
      select: { clientId: true },
    });
    return new Set(rows.map((row) => row.clientId));
  }
}
