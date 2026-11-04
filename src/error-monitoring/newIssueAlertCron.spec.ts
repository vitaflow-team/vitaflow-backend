import { MailService } from '@/mail/mail.service';
import { NewIssueAlertCron } from './newIssueAlertCron';
import {
  SentryGateway,
  SentryIssueSummary,
} from './gateway/sentry/sentryGateway';

function makeIssue(
  overrides: Partial<SentryIssueSummary> = {},
): SentryIssueSummary {
  return {
    id: 'issue-1',
    title: 'TypeError',
    culprit: 'src/foo.ts',
    level: 'error',
    count: 1,
    firstSeen: '2026-11-03T09:58:00.000Z',
    lastSeen: '2026-11-03T09:58:00.000Z',
    status: 'unresolved',
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('NewIssueAlertCron', () => {
  const listIssues = jest.fn();
  const sendNotificationEmail = jest.fn().mockResolvedValue(undefined);
  let cron: NewIssueAlertCron;

  beforeEach(() => {
    jest.clearAllMocks();
    sendNotificationEmail.mockResolvedValue(undefined);
    cron = new NewIssueAlertCron(
      { listIssues } as unknown as SentryGateway,
      'vitaflow-backend',
      'vitaflow-frontend',
      'ops@vitaflow.app',
      { sendNotificationEmail } as unknown as MailService,
    );
  });

  it('UT-014 does not send any e-mail when zero new issues are found', async () => {
    listIssues.mockResolvedValue([]);

    await cron.checkForNewIssues();
    await flushMicrotasks();

    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("UT-015 sends exactly one e-mail, naming the issue's app and title, for one new issue", async () => {
    listIssues.mockImplementation((projectSlug: string) =>
      Promise.resolve(
        projectSlug === 'vitaflow-backend'
          ? [makeIssue({ title: 'Boom' })]
          : [],
      ),
    );

    await cron.checkForNewIssues();
    await flushMicrotasks();

    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    const [, , , message] = sendNotificationEmail.mock.calls[0] as string[];
    expect(message).toContain('backend');
    expect(message).toContain('Boom');
  });

  it('UT-016 sends exactly three e-mails, once per issue, for three new issues', async () => {
    listIssues.mockImplementation((projectSlug: string) =>
      Promise.resolve(
        projectSlug === 'vitaflow-backend'
          ? [makeIssue({ id: 'b-1' }), makeIssue({ id: 'b-2' })]
          : [makeIssue({ id: 'f-1' })],
      ),
    );

    await cron.checkForNewIssues();
    await flushMicrotasks();

    expect(sendNotificationEmail).toHaveBeenCalledTimes(3);
  });

  it('UT-017 still attempts the second issue when the first MailService call rejects', async () => {
    listIssues.mockImplementation((projectSlug: string) =>
      Promise.resolve(
        projectSlug === 'vitaflow-backend'
          ? [makeIssue({ id: 'b-1' }), makeIssue({ id: 'b-2' })]
          : [],
      ),
    );
    sendNotificationEmail
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(undefined);

    await cron.checkForNewIssues();
    await flushMicrotasks();

    expect(sendNotificationEmail).toHaveBeenCalledTimes(2);
  });

  it('UT-028 sends only one e-mail when the same issue ID appears twice in a single poll result', async () => {
    listIssues.mockImplementation((projectSlug: string) =>
      Promise.resolve(
        projectSlug === 'vitaflow-backend'
          ? [makeIssue({ id: 'dup-1' }), makeIssue({ id: 'dup-1' })]
          : [],
      ),
    );

    await cron.checkForNewIssues();
    await flushMicrotasks();

    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  });
});
