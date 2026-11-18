import { InvoicesService } from '@/billing/invoices/invoices.service';
import { BILLING_LIMITS } from '@/billing/shared/billingLimits';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { canBill } from '@/billing/shared/premiumAccess';
import { CodedError } from '@/common/errors/codedError';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { GymRecurringBillingRepository } from '@/repositories/academia/gymRecurringBilling.repository';
import type { IssuableBilling } from '@/repositories/academia/types/issuableBilling';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { Clock } from '@/scheduling/clock.service';
import { sleep } from '@/utils/sleep';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingAccount } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { effectiveAmountCents, priceToCents } from './recurringBillingRules';
import { nextCompetenceToIssue, planFees } from './recurringSchedule';
import type { FeeOutcome } from './types/feeOutcome';
import type { FeePlan } from './types/feePlan';
import type { FeeRequest } from './types/feeRequest';
import type { OwnerGate } from './types/ownerGate';
import type { RunContext } from './types/runContext';
import type { IssuerRunSummary } from './types/issuerRunSummary';
import type { IssuerSkipReason } from './types/issuerSkipReason';

function emptySummary(): IssuerRunSummary {
  return { issued: 0, skipped: 0, failed: 0 };
}

function addTo(total: IssuerRunSummary, part: IssuerRunSummary): void {
  total.issued += part.issued;
  total.skipped += part.skipped;
  total.failed += part.failed;
}

function groupByOwner(billings: IssuableBilling[]): IssuableBilling[][] {
  const groups = new Map<string, IssuableBilling[]>();
  for (const item of billings) {
    const key = item.owner?.id ?? `no-owner:${item.client.id}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// The nightly job behind "nobody creates gym fees by hand" (ADR-007): for each
// active recurring row it issues the next competence when its due date is
// within the lead time, catching up the months a pause left behind. Each row is
// isolated (one failure never stops the others) and safety against a repeated
// or concurrent run rests on the unique invoice index, not on a lock.
@Injectable()
export class RecurringFeeIssuer {
  private readonly logger = new Logger(RecurringFeeIssuer.name);

  constructor(
    private readonly recurring: GymRecurringBillingRepository,
    private readonly invoices: InvoicesService,
    private readonly accounts: BillingAccountRepository,
    private readonly catalog: AcademiaAccessPlanRepository,
    private readonly clock: Clock,
  ) {}

  // After the 03:30 reconciliation, so statuses are fresh.
  @Cron('45 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<IssuerRunSummary> {
    const billings = await this.recurring.findIssuable();
    const context = await this.loadContext(billings);
    const summary = emptySummary();
    for (const group of groupByOwner(billings)) {
      addTo(summary, await this.processOwner(group, context));
    }
    this.logger.log(
      `recurring_fee_run issued=${summary.issued} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return summary;
  }

  private async loadContext(billings: IssuableBilling[]): Promise<RunContext> {
    const planIds = [...new Set(billings.map((b) => b.billing.accessPlanId))];
    const plans = await this.catalog.findByIds(planIds);
    return {
      today: brasiliaDateKey(this.clock.now()),
      lastCompetences: await this.recurring.findLastCompetences(),
      planPrices: new Map(
        plans.map((plan) => [plan.id, priceToCents(plan.referencePrice)]),
      ),
    };
  }

  private async processOwner(
    group: IssuableBilling[],
    context: RunContext,
  ): Promise<IssuerRunSummary> {
    const gate = await this.openGate(group[0]);
    if ('skip' in gate) {
      for (const item of group) this.logSkipped(item, gate.skip);
      return { issued: 0, skipped: group.length, failed: 0 };
    }
    const total = emptySummary();
    for (const item of group) {
      addTo(total, await this.processBilling(item, gate.account, context));
    }
    return total;
  }

  // An owner whose Vitaflow subscription lapsed or whose gateway account is
  // gone or rejected pauses issuing; existing fees stay as they are.
  private async openGate(item: IssuableBilling): Promise<OwnerGate> {
    const owner = item.owner;
    if (!owner) return { skip: 'account_unavailable' };
    if (!canBill(owner)) return { skip: 'subscription_inactive' };
    const account = await this.accounts.findActiveByUser(owner.id);
    if (!account || !account.apiKeyEncrypted || account.keyInvalidAt) {
      return { skip: 'account_unavailable' };
    }
    return { account };
  }

  private async processBilling(
    item: IssuableBilling,
    account: BillingAccount,
    context: RunContext,
  ): Promise<IssuerRunSummary> {
    const plan = this.feePlan(item, context);
    if (plan.fees.length === 0) {
      this.logSkipped(item, 'not_due');
      return { issued: 0, skipped: 1, failed: 0 };
    }

    let issued = 0;
    for (const fee of plan.fees) {
      const outcome = await this.issueFee({ item, account, fee, context });
      if (outcome === 'issued') {
        issued += 1;
        continue;
      }
      return this.summaryAfterStop(issued, outcome);
    }
    return { issued, skipped: 0, failed: 0 };
  }

  private feePlan(item: IssuableBilling, context: RunContext): FeePlan {
    const { billing, client } = item;
    const plan = planFees({
      next: nextCompetenceToIssue({
        last: context.lastCompetences.get(billing.id) ?? null,
        dueDay: billing.dueDay,
        startedAtKey: brasiliaDateKey(billing.startedAt),
      }),
      dueDay: billing.dueDay,
      today: context.today,
    });
    if (plan.cappedMonths > 0) {
      this.logger.warn(
        `recurring_catchup_capped clientId=${client.id} months=${plan.cappedMonths}`,
      );
    }
    return plan;
  }

  private summaryAfterStop(
    issued: number,
    outcome: Exclude<FeeOutcome, 'issued'>,
  ): IssuerRunSummary {
    if (outcome === 'failed') return { issued, skipped: 0, failed: 1 };
    return { issued, skipped: issued > 0 ? 0 : 1, failed: 0 };
  }

  private async issueFee(request: FeeRequest): Promise<FeeOutcome> {
    const { item, account, fee, context } = request;
    const { billing, client } = item;
    const amountCents = effectiveAmountCents(
      billing,
      context.planPrices.get(billing.accessPlanId) ?? null,
    );
    try {
      await this.invoices.issueRecurringFee({
        account,
        client,
        recurringBillingId: billing.id,
        competence: fee.competence,
        amountCents,
        dueDate: fee.dueDate,
      });
      this.logger.log(
        `recurring_fee_issued clientId=${client.id} competence=${fee.competence.year}/${fee.competence.month}`,
      );
    } catch (error) {
      return await this.outcomeOfFailure(item, error);
    }
    await sleep(BILLING_LIMITS.reconciliationCallSpacingMs);
    return 'issued';
  }

  // A fee already there (a repeated or concurrent run) and a student without
  // a tax ID are skips; anything else is a failure retried on the next run.
  private async outcomeOfFailure(
    item: IssuableBilling,
    error: unknown,
  ): Promise<Exclude<FeeOutcome, 'issued'>> {
    const code = error instanceof CodedError ? error.code : null;
    if (code === 'invoice_exists_for_month') {
      this.logSkipped(item, 'already_issued');
      return 'duplicate';
    }
    if (code === 'tax_id_required') {
      this.logSkipped(item, 'tax_id_missing');
      return 'tax_id_missing';
    }
    this.logger.error(
      `recurring_fee_failed clientId=${item.client.id} billingId=${item.billing.id}`,
    );
    Sentry.captureException(error, {
      extra: { ownerId: item.owner?.id, clientId: item.client.id },
    });
    await sleep(BILLING_LIMITS.reconciliationCallSpacingMs);
    return 'failed';
  }

  private logSkipped(item: IssuableBilling, reason: IssuerSkipReason): void {
    this.logger.log(
      `recurring_fee_skipped clientId=${item.client.id} reason=${reason}`,
    );
  }
}
