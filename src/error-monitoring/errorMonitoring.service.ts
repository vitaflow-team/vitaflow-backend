import { CodedError } from '@/common/errors/codedError';
import { Inject, Injectable } from '@nestjs/common';
import {
  SENTRY_BACKEND_PROJECT_SLUG,
  SENTRY_FRONTEND_PROJECT_SLUG,
} from './errorMonitoring.tokens';
import {
  GatewayError,
  SentryGateway,
  SentryIssueDetail,
  SentryIssueSummary,
} from './gateway/sentry/sentryGateway';
import { SENTRY_GATEWAY } from './gateway/sentry/sentryGateway.tokens';

export type ErrorMonitoringApp = 'backend' | 'frontend';

export interface ErrorMonitoringListResult {
  items: (SentryIssueSummary & { app: ErrorMonitoringApp })[];
}

// Read-only vitrine over Sentry (ADR-001/ADR-004) — no Prisma model, every
// call queries SentryGateway live. A GatewayError always becomes a
// CodedError with a stable `code`, never a raw Sentry/HTTP error.
@Injectable()
export class ErrorMonitoringService {
  constructor(
    @Inject(SENTRY_GATEWAY) private readonly sentry: SentryGateway,
    @Inject(SENTRY_BACKEND_PROJECT_SLUG)
    private readonly backendProjectSlug: string,
    @Inject(SENTRY_FRONTEND_PROJECT_SLUG)
    private readonly frontendProjectSlug: string,
  ) {}

  async list(): Promise<ErrorMonitoringListResult> {
    try {
      const [backend, frontend] = await Promise.all([
        this.sentry.listIssues(this.backendProjectSlug, 'is:unresolved'),
        this.sentry.listIssues(this.frontendProjectSlug, 'is:unresolved'),
      ]);
      return {
        items: [
          ...backend.map((issue) => ({ ...issue, app: 'backend' as const })),
          ...frontend.map((issue) => ({
            ...issue,
            app: 'frontend' as const,
          })),
        ],
      };
    } catch (error) {
      throw this.toCodedError(error);
    }
  }

  async detail(
    app: ErrorMonitoringApp,
    issueId: string,
  ): Promise<SentryIssueDetail> {
    const projectSlug = this.projectSlugFor(app);
    try {
      return await this.sentry.getIssueDetail(projectSlug, issueId);
    } catch (error) {
      throw this.toCodedError(error);
    }
  }

  private projectSlugFor(app: ErrorMonitoringApp): string {
    return app === 'backend'
      ? this.backendProjectSlug
      : this.frontendProjectSlug;
  }

  private toCodedError(error: unknown): unknown {
    if (!(error instanceof GatewayError)) return error;

    if (error.kind === 'not_found') {
      return new CodedError(
        'Issue não encontrada no Sentry.',
        404,
        'issue_not_found',
      );
    }
    return new CodedError(
      'O Sentry está indisponível no momento.',
      502,
      'sentry_unavailable',
    );
  }
}
