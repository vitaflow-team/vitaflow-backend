import {
  PAYMENT_GATEWAY,
  PAYMENT_ITEMS_PAGE_SIZE,
} from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import type { PaymentItemFilter } from '@/billing/gateway/types/paymentItemFilter';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { Clock } from '@/scheduling/clock.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { PLATFORM_ASAAS_API_KEY } from '../platformGateway.tokens';
import { PlatformPaymentIngest } from './platformPaymentIngest.service';
import type { SyncSummary } from './types/syncSummary';

// The rolling window the nightly sync re-reads (ADR-006): payments due within
// the last 60 and the next 30 days.
export const SYNC_WINDOW_DAYS_BACK = 60;
export const SYNC_WINDOW_DAYS_AHEAD = 30;

// A stop for a gateway that ignores the offset and answers full pages forever.
const MAX_PAGES = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(dateKey) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function emptySummary(): SyncSummary {
  return {
    ok: true,
    pages: 0,
    fetched: 0,
    upserted: 0,
    canceled: 0,
    skipped: 0,
    failedAtOffset: null,
  };
}

// Keeps the local payment table close to the gateway (ADR-006): a nightly
// re-read of a rolling window heals any notice the webhook missed, and the same
// paging loop runs the one-time backfill over the whole history. Every page is
// written as it arrives, so a failure keeps what is already stored and removes
// nothing.
@Injectable()
export class PlatformPaymentSync {
  private readonly logger = new Logger(PlatformPaymentSync.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PLATFORM_ASAAS_API_KEY) private readonly apiKey: string,
    private readonly ingest: PlatformPaymentIngest,
    private readonly clock: Clock,
  ) {}

  // After the 03:30 reconciliation and the 03:45 fee issuer, so the gateway
  // statuses are settled for the day.
  @Cron('15 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<SyncSummary> {
    const today = brasiliaDateKey(this.clock.now());
    return await this.sync('window', {
      dueFrom: addDays(today, -SYNC_WINDOW_DAYS_BACK),
      dueTo: addDays(today, SYNC_WINDOW_DAYS_AHEAD),
    });
  }

  // The whole payment history of the platform account (the one-time script).
  async backfill(): Promise<SyncSummary> {
    return await this.sync('backfill', {});
  }

  private async sync(
    mode: 'window' | 'backfill',
    range: Omit<PaymentItemFilter, 'offset'>,
  ): Promise<SyncSummary> {
    const summary = emptySummary();
    const position = { offset: 0 };
    try {
      await this.walkPages(range, summary, position);
    } catch (error) {
      summary.ok = false;
      summary.failedAtOffset = position.offset;
      Sentry.captureException(error, { extra: { mode, ...position } });
    }
    this.logRun(mode, summary);
    return summary;
  }

  // Reads page after page until a short one; `position` always names the page
  // being read or written, so a failure can say where it stopped.
  private async walkPages(
    range: Omit<PaymentItemFilter, 'offset'>,
    summary: SyncSummary,
    position: { offset: number },
  ): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const items = await this.gateway.listPaymentItems(this.apiKey, {
        ...range,
        offset: position.offset,
      });
      await this.writePage(summary, items);
      if (items.length < PAYMENT_ITEMS_PAGE_SIZE) return;
      position.offset += PAYMENT_ITEMS_PAGE_SIZE;
    }
  }

  private async writePage(
    summary: SyncSummary,
    items: GatewayPaymentItem[],
  ): Promise<void> {
    const outcome = await this.ingest.ingest(items);
    summary.pages += 1;
    summary.fetched += items.length;
    summary.upserted += outcome.upserted;
    summary.canceled += outcome.canceled;
    summary.skipped += outcome.skipped;
  }

  private logRun(mode: string, summary: SyncSummary): void {
    const line =
      `platform_sync_run mode=${mode} ok=${summary.ok} pages=${summary.pages} ` +
      `fetched=${summary.fetched} upserted=${summary.upserted} ` +
      `canceled=${summary.canceled} skipped=${summary.skipped}`;
    if (summary.ok) this.logger.log(line);
    else this.logger.error(`${line} failedAtOffset=${summary.failedAtOffset}`);
  }
}
