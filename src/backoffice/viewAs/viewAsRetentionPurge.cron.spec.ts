import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { subYears } from 'date-fns';
import { ViewAsRetentionPurgeCron } from './viewAsRetentionPurge.cron';

describe('ViewAsRetentionPurgeCron', () => {
  it('purges with a cutoff exactly 2 years before now', async () => {
    const sessions = { purgeOlderThan: jest.fn().mockResolvedValue(5) };
    const cron = new ViewAsRetentionPurgeCron(
      sessions as unknown as BackofficeViewAsSessionRepository,
    );

    await cron.purgeOldSessions();

    const cutoff = sessions.purgeOlderThan.mock.calls[0][0] as Date;
    const expectedCutoff = subYears(new Date(), 2);
    expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(
      5_000,
    );
  });
});
