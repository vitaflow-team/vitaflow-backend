import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/billing/gateway/paymentGateway';
import {
  computeCohortRetention,
  type CohortRetentionRow,
} from '@/backoffice/metrics/cohortRetention.util';
import {
  computeLtvBySegment,
  type LtvBySegmentEntry,
} from '@/backoffice/metrics/ltvBySegment.util';
import {
  RoleCount,
  UserRepository,
} from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { PLATFORM_ASAAS_API_KEY } from '@/users/subscription/platformGateway.tokens';
import {
  lastNMonthStarts,
  startOfMonth,
  startOfPreviousMonth,
} from '@/utils/monthRange';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductType } from '@prisma/client';

const ASAAS_CACHE_TTL_MS = 15 * 60 * 1000;

export interface RegisteredByRole {
  role: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';
  free: number;
  premium: number;
  newThisMonth: number;
}

export interface ChurnByRole {
  role: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';
  canceledThisMonth: number;
}

export interface PlatformMetrics {
  mrr: {
    current: number;
    previousMonth: number | null; // null = Asaas unavailable, never 0-as-unavailable
    asOf: string; // ISO timestamp of the cached/live Asaas read
  };
  registeredByRole: RegisteredByRole[];
  churnByRole: ChurnByRole[];
  cohortRetention: CohortRetentionRow[];
  ltvBySegment: LtvBySegmentEntry[];
}

interface AsaasRevenueCache {
  value: number;
  computedAt: Date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countFor(counts: RoleCount[], role: ProductType): number {
  return counts.find((count) => count.role === role)?.count ?? 0;
}

// Assembles the full platform metrics dashboard (ADR-005: one resilient
// endpoint, not three) — registered users and churn are purely local
// Prisma reads and always succeed; current MRR is local too. Only the MRR
// month-over-month comparison calls Asaas, in its own try/catch, cached in
// memory for 15 minutes (ADR-006). A failure there never affects the rest
// of the response, and is never itself cached.
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private cache: AsaasRevenueCache | null = null;

  constructor(
    private readonly users: UserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PLATFORM_ASAAS_API_KEY) private readonly platformApiKey: string,
    private readonly clock: Clock,
  ) {}

  async getPlatformMetrics(): Promise<PlatformMetrics> {
    const now = this.clock.now();
    const [
      registeredByRole,
      churnByRole,
      current,
      previousMonth,
      cohortRetention,
      ltvBySegment,
    ] = await Promise.all([
      this.buildRegisteredByRole(),
      this.buildChurnByRole(),
      this.users.sumActiveSubscriptionRevenue(),
      this.previousMonthRevenue(now),
      this.buildCohortRetention(now),
      this.buildLtvBySegment(now),
    ]);

    return {
      mrr: {
        current,
        previousMonth: previousMonth.value,
        asOf: previousMonth.asOf,
      },
      registeredByRole,
      churnByRole,
      cohortRetention,
      ltvBySegment,
    };
  }

  private async buildRegisteredByRole(): Promise<RegisteredByRole[]> {
    const [counts, newThisMonth] = await Promise.all([
      this.users.countRegisteredByRoleAndPlan(),
      this.users.countNewRegistrationsThisMonth(),
    ]);

    return counts.map((count) => ({
      role: count.role,
      free: count.free,
      premium: count.premium,
      newThisMonth: countFor(newThisMonth, count.role),
    }));
  }

  private async buildChurnByRole(): Promise<ChurnByRole[]> {
    const counts = await this.users.countCanceledThisMonth();
    return counts.map((count) => ({
      role: count.role,
      canceledThisMonth: count.count,
    }));
  }

  // Degrades to an empty array on failure, never throwing — mirrors the
  // MRR-trend degrade pattern below, so a bug in this bulk-fetch/in-memory
  // aggregation (cohort-ltv-analysis ADR-007) never takes down the rest of
  // the endpoint.
  private async buildCohortRetention(now: Date): Promise<CohortRetentionRow[]> {
    try {
      const since = lastNMonthStarts(now, 12)[0];
      const rows = await this.users.findCohortUsers(since);
      return computeCohortRetention(rows, now);
    } catch (error) {
      this.logger.warn(
        `platform_metrics_cohort_retention_failed error=${String(error)}`,
      );
      return [];
    }
  }

  private async buildLtvBySegment(now: Date): Promise<LtvBySegmentEntry[]> {
    try {
      const [rows, rolesWithPremiumOffering] = await Promise.all([
        this.users.findActivePremiumUsersForLtv(now),
        this.users.findRolesWithActivePremiumProduct(),
      ]);
      return computeLtvBySegment(rows, rolesWithPremiumOffering);
    } catch (error) {
      this.logger.warn(
        `platform_metrics_ltv_by_segment_failed error=${String(error)}`,
      );
      return [];
    }
  }

  // A cache hit reports the timestamp of the original successful read, not
  // "now" — `asOf` describes when the figure was actually read from Asaas.
  // A failure is never cached (ADR-006): the next call retries immediately.
  private async previousMonthRevenue(now: Date): Promise<{
    value: number | null;
    asOf: string;
  }> {
    if (
      this.cache &&
      now.getTime() - this.cache.computedAt.getTime() < ASAAS_CACHE_TTL_MS
    ) {
      return {
        value: this.cache.value,
        asOf: this.cache.computedAt.toISOString(),
      };
    }

    try {
      const value = await this.gateway.listPayments(this.platformApiKey, {
        from: dateOnly(startOfPreviousMonth(now)),
        to: dateOnly(startOfMonth(now)),
      });
      this.cache = { value, computedAt: now };
      return { value, asOf: now.toISOString() };
    } catch (error) {
      this.logger.warn(
        `platform_metrics_asaas_unavailable error=${String(error)}`,
      );
      return { value: null, asOf: now.toISOString() };
    }
  }
}
