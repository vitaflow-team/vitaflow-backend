import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import type { PlatformPaymentData } from '@/repositories/billing/types/platformPaymentData';
import type { PlatformSubscriber } from '@/repositories/users/types/platformSubscriber';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import { PlatformPaymentStatus } from '@prisma/client';
import { mapPlatformPaymentStatus } from './platformPaymentStatus';
import type { IngestOutcome } from './types/ingestOutcome';

function calendarDate(value: string): string {
  return value.slice(0, 10);
}

// A payment the gateway reports as paid without a payment date is dated on the
// day it was first seen, so it still lands in a month.
function paidAtOf(
  item: GatewayPaymentItem,
  status: PlatformPaymentStatus,
  today: string,
): string | null {
  if (item.paymentDate) return calendarDate(item.paymentDate);
  return status === PlatformPaymentStatus.PAID ? today : null;
}

// Turns gateway payments into rows of the local payment table (ADR-006). It is
// the one place that decides which payments are worth a row: a payment of a
// customer Vitaflow does not know, or in a status the panel has no figure for,
// is skipped and logged, never an error.
@Injectable()
export class PlatformPaymentIngest {
  private readonly logger = new Logger(PlatformPaymentIngest.name);

  constructor(
    private readonly users: UserRepository,
    private readonly payments: PlatformPaymentRepository,
    private readonly clock: Clock,
  ) {}

  async ingest(items: GatewayPaymentItem[]): Promise<IngestOutcome> {
    const removed = items.filter((item) => item.deleted);
    const live = items.filter((item) => !item.deleted);
    const canceled = await this.payments.cancelMany(
      removed.map((item) => item.id),
    );
    const rows = await this.rowsOf(live);
    const counts = await this.payments.upsertMany(rows);
    return {
      upserted: counts.created + counts.updated,
      canceled,
      skipped: live.length - rows.length,
    };
  }

  private async rowsOf(
    items: GatewayPaymentItem[],
  ): Promise<PlatformPaymentData[]> {
    const customers = [...new Set(items.map((item) => item.customer))];
    const subscribers =
      await this.users.findSubscribersByCustomerIds(customers);
    const byCustomer = new Map(
      subscribers.map((subscriber) => [subscriber.asaasCustomerId, subscriber]),
    );
    const today = brasiliaDateKey(this.clock.now());
    const rows = new Map<string, PlatformPaymentData>();
    for (const item of items) {
      const row = this.toRow(item, byCustomer.get(item.customer), today);
      if (row) rows.set(row.asaasPaymentId, row);
    }
    return [...rows.values()];
  }

  private toRow(
    item: GatewayPaymentItem,
    subscriber: PlatformSubscriber | undefined,
    today: string,
  ): PlatformPaymentData | null {
    if (!subscriber) {
      this.logger.warn(
        `platform_payment_skipped_unknown_customer paymentId=${item.id} customerId=${item.customer}`,
      );
      return null;
    }
    const status = mapPlatformPaymentStatus(item.status);
    if (!status) {
      this.logger.warn(
        `platform_payment_skipped paymentId=${item.id} reason=unmapped_status status=${item.status}`,
      );
      return null;
    }
    if (!subscriber.product) {
      this.logger.warn(
        `platform_payment_skipped paymentId=${item.id} reason=no_product userId=${subscriber.id}`,
      );
      return null;
    }
    return {
      asaasPaymentId: item.id,
      userId: subscriber.id,
      asaasCustomerId: item.customer,
      asaasSubscriptionId: item.subscription,
      productType: subscriber.product.type,
      productName: subscriber.product.name,
      valueCents: item.valueCents,
      status,
      dueDate: calendarDate(item.dueDate),
      paidAt: paidAtOf(item, status, today),
      paidAmountCents:
        status === PlatformPaymentStatus.PAID ? item.valueCents : null,
    };
  }
}
