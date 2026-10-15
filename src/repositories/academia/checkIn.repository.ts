import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { CheckIn, CheckInSource } from '@prisma/client';

export interface CheckInData {
  clientId: string;
  source: CheckInSource;
  registeredByStaffId: string | null;
  planValidAtCheckIn: boolean;
}

export type CheckInWithClientName = CheckIn & { client: { name: string } };

@Injectable()
export class CheckInRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CheckInData): Promise<CheckIn> {
    return await this.prisma.checkIn.create({ data });
  }

  /** Every check-in of every gym student at this academia, since the given instant. */
  async findByAcademiaSince(
    academiaId: string,
    since: Date,
  ): Promise<CheckInWithClientName[]> {
    return await this.prisma.checkIn.findMany({
      where: { client: { academiaId }, createdAt: { gte: since } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The most recent check-in per client at this academia, for the risk list. */
  async findLastCheckInByClient(
    academiaId: string,
  ): Promise<Map<string, Date>> {
    const rows = await this.prisma.checkIn.findMany({
      where: { client: { academiaId } },
      select: { clientId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const last = new Map<string, Date>();
    for (const row of rows) {
      if (!last.has(row.clientId)) last.set(row.clientId, row.createdAt);
    }
    return last;
  }
}
