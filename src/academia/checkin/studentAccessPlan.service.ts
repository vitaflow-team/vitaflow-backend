import { Clock } from '@/scheduling/clock.service';
import { brtDateKey } from '@/utils/brtDate';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { AccessPlanValidityType, StudentAccessPlan } from '@prisma/client';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';
const ACCESS_PLAN_NOT_FOUND = 'Plano de acesso não encontrado.';
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessPlanStatus = 'NO_PLAN' | 'VALID' | 'EXPIRED' | 'EXHAUSTED';

export interface CurrentAccessPlan {
  plan: StudentAccessPlan | null;
  status: AccessPlanStatus;
  remaining: number | null;
}

@Injectable()
export class StudentAccessPlanService {
  constructor(
    private readonly plans: StudentAccessPlanRepository,
    private readonly catalog: AcademiaAccessPlanRepository,
    private readonly clients: ClientsRepository,
    private readonly clock: Clock,
  ) {}

  // Lock-swap (ADR-007): create the new assignment ARCHIVED, then activate()
  // it — the only transition to ACTIVE, archiving the previous one in the
  // same transaction. Re-assigning the same plan is a renewal, not a no-op:
  // a fresh row with assignedAt reset, same as any other replacement.
  async assign(
    clientId: string,
    accessPlanId: string,
  ): Promise<StudentAccessPlan> {
    const client = await this.clients.getClientById(clientId);
    if (!client || !client.academiaId) {
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    }

    const catalogPlan = await this.catalog.findById(
      accessPlanId,
      client.academiaId,
    );
    if (!catalogPlan) {
      throw new CodedError(ACCESS_PLAN_NOT_FOUND, 404, 'access_plan_not_found');
    }

    const now = this.clock.now();
    const expiresAt =
      catalogPlan.validityType === AccessPlanValidityType.DAYS
        ? new Date(now.getTime() + catalogPlan.validityValue * DAY_MS)
        : null;

    const created = await this.plans.create({
      clientId,
      accessPlanId,
      validityType: catalogPlan.validityType,
      validityValue: catalogPlan.validityValue,
      referencePrice: Number(catalogPlan.referencePrice),
      expiresAt,
    });
    await this.plans.activate(clientId, created.id);
    return (await this.plans.findById(created.id))!;
  }

  async currentForClient(
    clientId: string,
    now: Date,
  ): Promise<CurrentAccessPlan> {
    const plan = await this.plans.findActiveByClient(clientId);
    if (!plan) {
      return { plan: null, status: 'NO_PLAN', remaining: null };
    }

    if (plan.validityType === AccessPlanValidityType.DAYS) {
      const status =
        plan.expiresAt && plan.expiresAt < now ? 'EXPIRED' : 'VALID';
      return { plan, status, remaining: null };
    }

    const timestamps = await this.plans.findCheckInTimestampsSince(
      clientId,
      plan.assignedAt,
    );
    const distinctDays = new Set(
      timestamps.map((timestamp) => brtDateKey(timestamp)),
    ).size;
    const remaining = plan.validityValue - distinctDays;
    const status = remaining <= 0 ? 'EXHAUSTED' : 'VALID';
    return { plan, status, remaining };
  }
}
