import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

// Closes out every "ver como" session whose JWT self-expired with no
// further activity (platform-admin-access ADR-007) — endedAt is set to
// that row's own expiresAt, not "now," so the audit record stays exact.
@Injectable()
export class ViewAsExpirySweepCron {
  private readonly logger = new Logger(ViewAsExpirySweepCron.name);

  constructor(private readonly sessions: BackofficeViewAsSessionRepository) {}

  @Cron('*/5 * * * *')
  async closeExpiredSessions(): Promise<void> {
    const closed = await this.sessions.closeExpiredSessions();
    this.logger.log(`view_as_expiry_sweep_run closed=${closed}`);
  }
}
