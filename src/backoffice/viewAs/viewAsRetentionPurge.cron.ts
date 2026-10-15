import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { subYears } from 'date-fns';

const RETENTION_YEARS = 2;

// Daily purge of audit records past the 2-year retention period
// (platform-admin-access ADR-007).
@Injectable()
export class ViewAsRetentionPurgeCron {
  private readonly logger = new Logger(ViewAsRetentionPurgeCron.name);

  constructor(private readonly sessions: BackofficeViewAsSessionRepository) {}

  @Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async purgeOldSessions(): Promise<void> {
    const cutoff = subYears(new Date(), RETENTION_YEARS);
    const purged = await this.sessions.purgeOlderThan(cutoff);
    this.logger.log(`view_as_retention_purge_run purged=${purged}`);
  }
}
