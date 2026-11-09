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
}
