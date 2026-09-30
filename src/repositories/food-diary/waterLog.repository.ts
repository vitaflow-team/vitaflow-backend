import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { WaterLog } from '@prisma/client';

@Injectable()
export class WaterLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserAndDate(
    userId: string,
    date: Date,
  ): Promise<WaterLog | null> {
    return await this.prisma.waterLog.findUnique({
      where: { userId_date: { userId, date } },
    });
  }

  async increment(userId: string, date: Date): Promise<WaterLog> {
    return await this.prisma.waterLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  // Atomic floor at 0: the conditional `updateMany` only decrements a row
  // whose count is still > 0 at the moment the statement runs, so two
  // concurrent decrements at count 1 can never both succeed and leave -1.
  async decrement(userId: string, date: Date): Promise<WaterLog> {
    const { count: affected } = await this.prisma.waterLog.updateMany({
      where: { userId, date, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });

    if (affected === 0) {
      return await this.prisma.waterLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, count: 0 },
        update: {},
      });
    }

    return await this.prisma.waterLog.findUniqueOrThrow({
      where: { userId_date: { userId, date } },
    });
  }
}
