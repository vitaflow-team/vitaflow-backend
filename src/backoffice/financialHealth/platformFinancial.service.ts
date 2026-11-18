import { CodedError } from '@/common/errors/codedError';
import {
  DELINQUENT_PAGE_SIZE,
  monthKey,
  monthRangeOf,
  parseMonth,
  previousMonth,
  requestedPage,
  resolvePage,
  todayKey,
} from '@/financial-health/shared/financialDefinitions';
import type { MonthRange } from '@/financial-health/types/monthRange';
import { BackofficeAccessLogRepository } from '@/repositories/backoffice/backofficeAccessLog.repository';
import { PlatformFinancialRepository } from '@/repositories/billing/platformFinancial.repository';
import type { PlatformSummaryFigures } from '@/repositories/billing/types/platformSummaryFigures';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import { BackofficeAccessResource, BackofficeTier } from '@prisma/client';
import type { PlatformDelinquentsResponseDTO } from './dto/platformDelinquentsResponse.Dto';
import type { PlatformSummaryResponseDTO } from './dto/platformSummaryResponse.Dto';
import {
  accountTotalsOf,
  platformOverdueOf,
  totalsOf,
} from './platformFinancialMapper';
import type { BackofficeStaff } from './types/backofficeStaff';

const ACCESS_LOG_FAILED =
  'Não foi possível registrar o acesso à lista. Tente novamente.';

function monthStartOf(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

// A tier the staff row does not carry is treated as the narrower one.
function tierOf(staff: BackofficeStaff): BackofficeTier {
  return staff.backofficeTier ?? BackofficeTier.EQUIPE;
}

// The Vitaflow team's view of its own subscription revenue (ADR-003, ADR-006,
// ADR-010). It reads only the local payment table, never the gateway, so a
// gateway outage cannot blank the panel.
@Injectable()
export class PlatformFinancialService {
  private readonly logger = new Logger(PlatformFinancialService.name);

  constructor(
    private readonly payments: PlatformFinancialRepository,
    private readonly accessLog: BackofficeAccessLogRepository,
    private readonly clock: Clock,
  ) {}

  async summary(
    rawMonth: string | undefined,
  ): Promise<PlatformSummaryResponseDTO> {
    const today = todayKey(this.clock.now());
    const current = parseMonth(rawMonth, today);
    const previous = monthRangeOf(
      previousMonth(monthKey(current.year, current.month)),
    );
    const [figures, earliest, syncedAt] = await Promise.all([
      this.payments.summaryFigures({ current, previous, today }),
      this.payments.earliestDueDate(),
      this.payments.lastSyncedAt(),
    ]);
    const historyStart = earliest === null ? null : monthStartOf(earliest);
    const base = {
      month: monthKey(current.year, current.month),
      syncedAt: syncedAt === null ? null : syncedAt.toISOString(),
      overdue: platformOverdueOf(figures.total, figures.byAccountType),
    };
    if (!this.hasHistory(current, historyStart, today)) {
      return {
        ...base,
        available: false,
        totals: null,
        byAccountType: null,
        previous: null,
      };
    }
    return {
      ...base,
      available: true,
      totals: totalsOf(figures.total.current),
      byAccountType: accountTotalsOf(figures.byAccountType, 'current'),
      previous: this.previousOf(previous, historyStart, figures),
    };
  }

  // One page of the delinquent users. The access is recorded first, in the same
  // request: if the record cannot be written nothing is read and nothing is
  // returned (access without a record is not allowed, ADR-010).
  async delinquents(
    staff: BackofficeStaff,
    rawPage: string | undefined,
  ): Promise<PlatformDelinquentsResponseDTO> {
    const tier = tierOf(staff);
    await this.recordAccess(staff.id, tier, requestedPage(rawPage));

    const today = todayKey(this.clock.now());
    const counts = await this.payments.delinquentCounts(today);
    const page = resolvePage(rawPage, counts.total);
    const rows = await this.payments.delinquentUsers({
      today,
      limit: DELINQUENT_PAGE_SIZE,
      offset: (page - 1) * DELINQUENT_PAGE_SIZE,
    });
    return {
      tier,
      bandCounts: {
        d1to7: counts.d1to7,
        d8to30: counts.d8to30,
        d31Plus: counts.d31Plus,
      },
      items: rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        accountType: row.accountType,
        planName: row.planName,
        totalOwedCents: row.totalOwedCents,
        oldestDaysOverdue: row.oldestDaysOverdue,
      })),
      page,
      pageSize: DELINQUENT_PAGE_SIZE,
      total: counts.total,
    };
  }

  // A month is available from the month of the first stored payment on. With
  // nothing stored yet only the current month is (as an honest zero).
  private hasHistory(
    month: MonthRange,
    historyStart: string | null,
    today: string,
  ): boolean {
    if (historyStart === null) {
      return month.start === parseMonth(undefined, today).start;
    }
    return month.start >= historyStart;
  }

  private previousOf(
    previous: MonthRange,
    historyStart: string | null,
    figures: PlatformSummaryFigures,
  ): PlatformSummaryResponseDTO['previous'] {
    if (historyStart === null || previous.start < historyStart) return null;
    return {
      month: monthKey(previous.year, previous.month),
      totals: totalsOf(figures.total.previous),
      byAccountType: accountTotalsOf(figures.byAccountType, 'previous'),
    };
  }

  private async recordAccess(
    staffUserId: string,
    tier: BackofficeTier,
    page: number,
  ): Promise<void> {
    try {
      await this.accessLog.create({
        staffUserId,
        tier,
        resource: BackofficeAccessResource.FINANCIAL_DELINQUENT_LIST,
        page,
      });
    } catch {
      this.logger.error(
        `backoffice_access_log_failed staffUserId=${staffUserId} resource=FINANCIAL_DELINQUENT_LIST`,
      );
      throw new CodedError(ACCESS_LOG_FAILED, 503, 'access_log_failed');
    }
  }
}
