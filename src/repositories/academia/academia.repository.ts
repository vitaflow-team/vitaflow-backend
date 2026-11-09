import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AcademiaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every academia with at least one student — the churn-risk cron's own
   * per-academia loop target (ADR-007). */
  async findIdsWithStudents(): Promise<string[]> {
    const rows = await this.prisma.academia.findMany({
      where: { students: { some: {} } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** null = never evaluated by the churn-risk feature (ADR-005's silent-
   * baseline marker). */
  async findChurnRiskBaselineAt(academiaId: string): Promise<Date | null> {
    const academia = await this.prisma.academia.findUnique({
      where: { id: academiaId },
      select: { churnRiskBaselineAt: true },
    });
    return academia?.churnRiskBaselineAt ?? null;
  }

  /** Set once, after this academia's first-ever churn-risk evaluation
   * completes — regardless of whether any student matched (ADR-005). */
  async markChurnRiskBaselined(academiaId: string, at: Date): Promise<void> {
    await this.prisma.academia.update({
      where: { id: academiaId },
      data: { churnRiskBaselineAt: at },
    });
  }
}
