import { brasiliaDateKey, dateOnlyKey } from '@/billing/shared/dates';
import { isOverdue } from '@/financial-health/shared/financialDefinitions';
import { AcademiaRepository } from '@/repositories/academia/academia.repository';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import type { CheckInNotice } from './types/checkInNotice';

// Whether the receptionist should send a student to the administration: the
// student has a fee on the gym's billing account that is open and past its due
// date. Any failure to find out means no notice; a check-in is never held up
// by it (US-019 EC-4).
@Injectable()
export class CheckInNoticeService {
  private readonly logger = new Logger(CheckInNoticeService.name);

  constructor(
    private readonly academias: AcademiaRepository,
    private readonly accounts: BillingAccountRepository,
    private readonly invoices: InvoicesRepository,
    private readonly clock: Clock,
  ) {}

  async noticeFor(
    clientId: string,
    academiaId: string,
  ): Promise<CheckInNotice | null> {
    try {
      const overdue = await this.hasOverdueFee(clientId, academiaId);
      return overdue ? 'SEE_ADMINISTRATION' : null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `checkin_notice_lookup_failed clientId=${clientId} reason=${reason}`,
      );
      return null;
    }
  }

  private async hasOverdueFee(
    clientId: string,
    academiaId: string,
  ): Promise<boolean> {
    const ownerId = await this.academias.findOwnerId(academiaId);
    if (!ownerId) return false;
    const account = await this.accounts.findActiveByUser(ownerId);
    if (!account) return false;
    const open = await this.invoices.findOpenAndOverdueByClient(
      clientId,
      ownerId,
    );
    const today = brasiliaDateKey(this.clock.now());
    return open.some(
      (invoice) =>
        invoice.externalId !== null &&
        isOverdue(
          { status: invoice.status, dueDate: dateOnlyKey(invoice.dueDate) },
          today,
        ),
    );
  }
}
