import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { ViewAsExpirySweepCron } from './viewAsExpirySweep.cron';

describe('ViewAsExpirySweepCron — platform-admin-access UT-026', () => {
  it('delegates the deterministic per-row endedAt=expiresAt update to the repository', async () => {
    const sessions = { closeExpiredSessions: jest.fn().mockResolvedValue(3) };
    const cron = new ViewAsExpirySweepCron(
      sessions as unknown as BackofficeViewAsSessionRepository,
    );

    await cron.closeExpiredSessions();

    expect(sessions.closeExpiredSessions).toHaveBeenCalledTimes(1);
  });
});
