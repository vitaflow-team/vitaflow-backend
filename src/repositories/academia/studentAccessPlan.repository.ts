import { PrismaService } from '@/database/prisma.service';
import { brtDateKey } from '@/utils/brtDate';
import { Injectable } from '@nestjs/common';
import {
  AccessPlanValidityType,
  StudentAccessPlan,
  StudentAccessPlanStatus,
} from '@prisma/client';

export interface StudentAccessPlanData {
  clientId: string;
  accessPlanId: string;
  validityType: AccessPlanValidityType;
  validityValue: number;
  referencePrice: number;
  expiresAt: Date | null;
}

// Mirrors StudentAccessPlanService's own AccessPlanStatus union (ADR-008):
// duplicated, not imported, since a repository never depends on a domain
// service, and the TechSpec's Known Risks explicitly accepts this as the
// one place the two classifications could drift, mitigated by the parity
// test (UT-019) rather than shared code.
export type AcademiaPlanStatusValue =
  | 'NO_PLAN'
  | 'VALID'
  | 'EXPIRED'
  | 'EXHAUSTED';

export interface AcademiaPlanStatus {
  clientId: string;
  status: AcademiaPlanStatusValue;
}

interface ActivePlanRow {
  clientId: string;
  validityType: AccessPlanValidityType;
  validityValue: number;
  expiresAt: Date | null;
  assignedAt: Date;
}

function classifyAcademiaPlanStatus(
  plan: ActivePlanRow | undefined,
  distinctVisitDays: number,
  now: Date,
): AcademiaPlanStatusValue {
  if (!plan) return 'NO_PLAN';
  if (plan.validityType === AccessPlanValidityType.DAYS) {
    return plan.expiresAt && plan.expiresAt < now ? 'EXPIRED' : 'VALID';
  }
  const remaining = plan.validityValue - distinctVisitDays;
  return remaining <= 0 ? 'EXHAUSTED' : 'VALID';
}

@Injectable()
export class StudentAccessPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Always created ARCHIVED: activate() does the only transition to ACTIVE,
  // so the partial unique index is never transiently violated.
  async create(data: StudentAccessPlanData): Promise<StudentAccessPlan> {
    return await this.prisma.studentAccessPlan.create({
      data: {
        client: { connect: { id: data.clientId } },
        accessPlan: { connect: { id: data.accessPlanId } },
        validityType: data.validityType,
        validityValue: data.validityValue,
        referencePrice: data.referencePrice,
        expiresAt: data.expiresAt,
        status: StudentAccessPlanStatus.ARCHIVED,
      },
    });
  }

  // Copies EducatorWorkoutsRepository.activate()'s exact shape (ADR-007):
  // row-lock the Client, early-return false if the target is missing or
  // already ACTIVE, archive every other ACTIVE assignment, activate the
  // target — all in one transaction.
  async activate(
    clientId: string,
    studentAccessPlanId: string,
  ): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

      const target = await tx.studentAccessPlan.findFirst({
        where: { id: studentAccessPlanId, clientId },
        select: { status: true },
      });
      if (!target) return false;
      if (target.status === StudentAccessPlanStatus.ACTIVE) return false;

      await tx.studentAccessPlan.updateMany({
        where: {
          clientId,
          status: StudentAccessPlanStatus.ACTIVE,
          id: { not: studentAccessPlanId },
        },
        data: { status: StudentAccessPlanStatus.ARCHIVED },
      });
      await tx.studentAccessPlan.update({
        where: { id: studentAccessPlanId },
        data: { status: StudentAccessPlanStatus.ACTIVE },
      });
      return true;
    });
  }

  async findActiveByClient(
    clientId: string,
  ): Promise<StudentAccessPlan | null> {
    return await this.prisma.studentAccessPlan.findFirst({
      where: { clientId, status: StudentAccessPlanStatus.ACTIVE },
    });
  }

  async findById(id: string): Promise<StudentAccessPlan | null> {
    return await this.prisma.studentAccessPlan.findUnique({ where: { id } });
  }

  // Additive — for the student-access-plan-profile mirror's plan-history
  // section (TechSpec § Core Interfaces). ARCHIVED rows are the full
  // assignment history minus the current one (which currentForClient
  // already serves); updatedAt doubles as "ended around" since activate()
  // is the only path that ever sets a row to ARCHIVED (TechSpec § Data
  // Models) and that write always touches @updatedAt.
  async findHistoryByClient(
    clientId: string,
    limit: number,
  ): Promise<(StudentAccessPlan & { accessPlan: { name: string } })[]> {
    return (await this.prisma.studentAccessPlan.findMany({
      where: { clientId, status: StudentAccessPlanStatus.ARCHIVED },
      orderBy: { assignedAt: 'desc' },
      take: limit,
      include: { accessPlan: { select: { name: true } } },
    })) as (StudentAccessPlan & { accessPlan: { name: string } })[];
  }

  /** Raw check-in timestamps of this client since the given instant — the
   * caller buckets them into distinct BRT calendar days (ADR-003). */
  async findCheckInTimestampsSince(
    clientId: string,
    since: Date,
  ): Promise<Date[]> {
    const rows = await this.prisma.checkIn.findMany({
      where: { clientId, createdAt: { gte: since } },
      select: { createdAt: true },
    });
    return rows.map((row) => row.createdAt);
  }

  // Batch counterpart to StudentAccessPlanService.currentForClient (ADR-008):
  // classifies every student of an academia in a small, fixed number of
  // queries (not one `currentForClient` call per student) — currentForClient
  // itself is unchanged, this is purely additive alongside it.
  async findStatusesByAcademia(
    academiaId: string,
    now: Date,
  ): Promise<AcademiaPlanStatus[]> {
    const clients = await this.prisma.client.findMany({
      where: { academiaId },
      select: { id: true },
    });
    const activePlans = await this.prisma.studentAccessPlan.findMany({
      where: { status: StudentAccessPlanStatus.ACTIVE, client: { academiaId } },
      select: {
        clientId: true,
        validityType: true,
        validityValue: true,
        expiresAt: true,
        assignedAt: true,
      },
    });
    const planByClient = new Map(
      activePlans.map((plan) => [plan.clientId, plan]),
    );
    const visitDaysByClient =
      await this.findDistinctVisitDaysByClient(activePlans);

    return clients.map((client) => ({
      clientId: client.id,
      status: classifyAcademiaPlanStatus(
        planByClient.get(client.id),
        visitDaysByClient.get(client.id) ?? 0,
        now,
      ),
    }));
  }

  // One query covering every VISITS-plan client at this academia (each with
  // its own since-assignedAt threshold via OR), not one query per client.
  private async findDistinctVisitDaysByClient(
    activePlans: ActivePlanRow[],
  ): Promise<Map<string, number>> {
    const visitsPlans = activePlans.filter(
      (plan) => plan.validityType === AccessPlanValidityType.VISITS,
    );
    if (visitsPlans.length === 0) return new Map();

    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        OR: visitsPlans.map((plan) => ({
          clientId: plan.clientId,
          createdAt: { gte: plan.assignedAt },
        })),
      },
      select: { clientId: true, createdAt: true },
    });

    const daysByClient = new Map<string, Set<string>>();
    for (const checkIn of checkIns) {
      const days = daysByClient.get(checkIn.clientId) ?? new Set<string>();
      days.add(brtDateKey(checkIn.createdAt));
      daysByClient.set(checkIn.clientId, days);
    }
    return new Map(
      [...daysByClient].map(([clientId, days]) => [clientId, days.size]),
    );
  }
}
