import { MailService } from '@/mail/mail.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ERROR_ALERT_EMAIL,
  SENTRY_BACKEND_PROJECT_SLUG,
  SENTRY_FRONTEND_PROJECT_SLUG,
} from './errorMonitoring.tokens';
import {
  SentryGateway,
  SentryIssueSummary,
} from './gateway/sentry/sentryGateway';
import { SENTRY_GATEWAY } from './gateway/sentry/sentryGateway.tokens';

interface NewIssue {
  app: 'backend' | 'frontend';
  issue: SentryIssueSummary;
}

// ADR-005: polls Sentry every 5 minutes (no Sentry alert-rule webhook — its
// availability on the free tier couldn't be confirmed) instead of relying
// on a persisted cursor (ADR-004, stateless). Queries a window wider than
// the schedule (`firstSeen:-6m` against a 5-minute interval) to absorb
// clock drift at the boundary, and de-duplicates by issue ID within a
// single run's combined result set.
@Injectable()
export class NewIssueAlertCron {
  private readonly logger = new Logger(NewIssueAlertCron.name);

  constructor(
    @Inject(SENTRY_GATEWAY) private readonly sentry: SentryGateway,
    @Inject(SENTRY_BACKEND_PROJECT_SLUG)
    private readonly backendProjectSlug: string,
    @Inject(SENTRY_FRONTEND_PROJECT_SLUG)
    private readonly frontendProjectSlug: string,
    @Inject(ERROR_ALERT_EMAIL) private readonly alertEmail: string,
    private readonly mail: MailService,
  ) {}

  @Cron('*/5 * * * *')
  async checkForNewIssues(): Promise<void> {
    const [backendIssues, frontendIssues] = await Promise.all([
      this.pollProject('backend', this.backendProjectSlug),
      this.pollProject('frontend', this.frontendProjectSlug),
    ]);

    const seen = new Set<string>();
    const newIssues = [...backendIssues, ...frontendIssues].filter(
      ({ issue }) => {
        if (seen.has(issue.id)) return false;
        seen.add(issue.id);
        return true;
      },
    );

    newIssues.forEach((entry) => this.sendAlert(entry));

    this.logger.log(
      `new_issue_alert_sweep_run found=${newIssues.length} emailed=${newIssues.length}`,
    );
  }

  private async pollProject(
    app: 'backend' | 'frontend',
    projectSlug: string,
  ): Promise<NewIssue[]> {
    try {
      const issues = await this.sentry.listIssues(projectSlug, 'firstSeen:-6m');
      return issues.map((issue) => ({ app, issue }));
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.error(
        `new_issue_alert_poll_failed app=${app} error=${reason}`,
      );
      return [];
    }
  }

  // Fire-and-forget per issue (recoverpass.service.ts's existing .catch()
  // pattern) — a MailService rejection for one issue must not prevent the
  // cron from attempting the remaining issues in this run.
  private sendAlert(entry: NewIssue): void {
    void this.mail
      .sendNotificationEmail(
        'Equipe Vita Flow',
        this.alertEmail,
        `Novo erro em produção (${entry.app})`,
        `Um novo erro foi detectado em ${entry.app}: ${entry.issue.title}`,
      )
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.name : 'unknown';
        this.logger.error(
          `new_issue_alert_email_failed issue=${entry.issue.id} error=${reason}`,
        );
      });
  }
}
