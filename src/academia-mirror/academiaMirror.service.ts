import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import {
  CurrentAccessPlan,
  StudentAccessPlanService,
} from '@/academia/checkin/studentAccessPlan.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable } from '@nestjs/common';
import {
  AccessPlanValidityType,
  Client,
  StudentAccessPlan,
} from '@prisma/client';
import {
  AcademiaMembershipEntity,
  ArchivedAccessPlanEntity,
  CurrentAccessPlanEntity,
} from './academiaMirror.entity';

// Mirrors PAINEL_ACTIVITY_LIMIT's precedent (role-management-dashboards
// ADR-008) for a plain historical list, not a severity-ranked attention
// list (TechSpec § Key Decisions).
const ACADEMIA_PLAN_HISTORY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

type AcademiaMembershipRow = Client & { academia: { name: string } };
type ArchivedPlanRow = StudentAccessPlan & { accessPlan: { name: string } };

// Only populated for status === 'VALID' (TechSpec § Data Models): a DAYS
// plan's remaining is computed here from expiresAt, since
// currentForClient never populates it for DAYS plans; a VISITS plan's
// remaining is currentForClient's own value, clamped so the exhaustion
// boundary (<= 0) never surfaces as a negative number.
function remainingDisplayValue(
  current: CurrentAccessPlan,
  now: Date,
): number | null {
  if (!current.plan || current.status !== 'VALID') return null;

  if (current.plan.validityType === AccessPlanValidityType.DAYS) {
    return current.plan.expiresAt
      ? Math.ceil((current.plan.expiresAt.getTime() - now.getTime()) / DAY_MS)
      : null;
  }

  return current.remaining === null ? null : Math.max(0, current.remaining);
}

function toArchivedEntity(row: ArchivedPlanRow): ArchivedAccessPlanEntity {
  return {
    id: row.id,
    planName: row.accessPlan.name,
    validityType: row.validityType,
    validityValue: row.validityValue,
    assignedAt: row.assignedAt.toISOString(),
    endedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class AcademiaMirrorService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly currentPlan: StudentAccessPlanService,
    private readonly planHistory: StudentAccessPlanRepository,
    private readonly catalog: AcademiaAccessPlanRepository,
    private readonly clock: Clock,
  ) {}

  async getMemberships(userId: string): Promise<AcademiaMembershipEntity[]> {
    const memberships =
      await this.clients.findAcademiaMembershipsByUserId(userId);
    const now = this.clock.now();
    return await Promise.all(
      memberships.map((membership) => this.toMembershipEntity(membership, now)),
    );
  }

  private async toMembershipEntity(
    membership: AcademiaMembershipRow,
    now: Date,
  ): Promise<AcademiaMembershipEntity> {
    const academiaId = membership.academiaId as string;
    const [current, history] = await Promise.all([
      this.currentPlan.currentForClient(membership.id, now),
      this.planHistory.findHistoryByClient(
        membership.id,
        ACADEMIA_PLAN_HISTORY_LIMIT,
      ),
    ]);

    return {
      academiaId,
      academiaName: membership.academia.name,
      currentPlan: await this.toCurrentPlanEntity(current, academiaId, now),
      history: history.map(toArchivedEntity),
    };
  }

  private async toCurrentPlanEntity(
    current: CurrentAccessPlan,
    academiaId: string,
    now: Date,
  ): Promise<CurrentAccessPlanEntity> {
    if (!current.plan) {
      return {
        status: current.status,
        planName: null,
        validityType: null,
        validityValue: null,
        remaining: null,
      };
    }

    const catalogPlan = await this.catalog.findById(
      current.plan.accessPlanId,
      academiaId,
    );
    return {
      status: current.status,
      planName: catalogPlan?.name ?? null,
      validityType: current.plan.validityType,
      validityValue: current.plan.validityValue,
      remaining: remainingDisplayValue(current, now),
    };
  }
}
