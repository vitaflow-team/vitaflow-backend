import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { CodedError } from '@/common/errors/codedError';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { FinancialHealthRepository } from '@/repositories/billing/financialHealth.repository';
import type { SummaryFigures } from '@/repositories/billing/types/summaryFigures';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import type { DelinquentsResponseDTO } from './dto/delinquentsResponse.Dto';
import type { FinancialSummaryResponseDTO } from './dto/financialSummaryResponse.Dto';
import {
  DELINQUENT_PAGE_SIZE,
  monthKey,
  monthRangeOf,
  parseMonth,
  previousMonth,
  resolvePage,
  todayKey,
} from './shared/financialDefinitions';
import type { BillingState } from './types/billingState';
import type { PanelAudience } from './types/panelAudience';

const UNAVAILABLE = 'Os dados financeiros estão indisponíveis no momento.';
const SLOW_QUERY_MS = 1_000;

function audienceOf(owner: BillingOwner): PanelAudience {
  return owner.kind === 'GYM' ? 'GYM' : 'PROFESSIONAL';
}

@Injectable()
export class FinancialHealthService {
  private readonly logger = new Logger(FinancialHealthService.name);

  constructor(
    private readonly repository: FinancialHealthRepository,
    private readonly accounts: BillingAccountRepository,
    private readonly clock: Clock,
  ) {}

  // The month panel (ADR-004): expected, received and still owed for the
  // selected and the previous month, plus the current overdue situation.
  async summary(
    owner: BillingOwner,
    rawMonth: string | undefined,
  ): Promise<FinancialSummaryResponseDTO> {
    const now = this.clock.now();
    const today = todayKey(now);
    const current = parseMonth(rawMonth, today);
    const previous = monthRangeOf(
      previousMonth(monthKey(current.year, current.month)),
    );

    const [figures, billingState, hasHistory] = await this.guarded(
      owner,
      now,
      () =>
        Promise.all([
          this.repository.summaryFigures({
            ownerId: owner.ownerId,
            current,
            previous,
            today,
          }),
          this.billingStateOf(owner.ownerId),
          this.repository.hasAnyInvoice(owner.ownerId),
        ]),
    );
    return this.toSummary(owner, {
      month: monthKey(current.year, current.month),
      figures,
      billingState,
      hasHistory,
    });
  }

  // One page of the delinquent people, worst first. A page past the end is the
  // last page; anything that is not a positive whole number is page 1.
  async delinquents(
    owner: BillingOwner,
    rawPage: string | undefined,
  ): Promise<DelinquentsResponseDTO> {
    const now = this.clock.now();
    const today = todayKey(now);

    return await this.guarded(owner, now, async () => {
      const total = await this.repository.countDelinquentClients(
        owner.ownerId,
        today,
      );
      const page = resolvePage(rawPage, total);
      const items = await this.repository.delinquentClients({
        ownerId: owner.ownerId,
        today,
        limit: DELINQUENT_PAGE_SIZE,
        offset: (page - 1) * DELINQUENT_PAGE_SIZE,
      });
      return { items, page, pageSize: DELINQUENT_PAGE_SIZE, total };
    });
  }

  // The account state is independent of the figures: a disconnected owner
  // keeps seeing history, and a refused key keeps showing figures with a
  // reconnect notice (PRD rules 36 and 37).
  private async billingStateOf(ownerId: string): Promise<BillingState> {
    const account = await this.accounts.findActiveByUser(ownerId);
    if (!account || account.apiKeyEncrypted === null) return 'NOT_CONNECTED';
    return account.keyInvalidAt ? 'RECONNECT_NEEDED' : 'CONNECTED';
  }

  // Any read failure is one coded, safe answer: never a partial panel.
  private async guarded<T>(
    owner: BillingOwner,
    startedAt: Date,
    read: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await read();
      this.warnWhenSlow(owner, startedAt);
      return result;
    } catch (error) {
      this.logger.error(
        `financial_query_failed kind=${owner.kind} reason=${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new CodedError(UNAVAILABLE, 503, 'financial_data_unavailable');
    }
  }

  private warnWhenSlow(owner: BillingOwner, startedAt: Date): void {
    const elapsed = this.clock.now().getTime() - startedAt.getTime();
    if (elapsed > SLOW_QUERY_MS) {
      this.logger.warn(
        `financial_query_slow kind=${owner.kind} elapsedMs=${elapsed}`,
      );
    }
  }

  private toSummary(
    owner: BillingOwner,
    input: {
      month: string;
      figures: SummaryFigures;
      billingState: BillingState;
      hasHistory: boolean;
    },
  ): FinancialSummaryResponseDTO {
    const { current, previous, overdue } = input.figures;
    return {
      audience: audienceOf(owner),
      billingState: input.billingState,
      hasHistory: input.hasHistory,
      month: input.month,
      current,
      previous,
      overdue: {
        totalCents:
          overdue.d1to7Cents + overdue.d8to30Cents + overdue.d31PlusCents,
        delinquentCount: overdue.delinquentCount,
        bands: {
          d1to7Cents: overdue.d1to7Cents,
          d8to30Cents: overdue.d8to30Cents,
          d31PlusCents: overdue.d31PlusCents,
        },
      },
    };
  }
}
