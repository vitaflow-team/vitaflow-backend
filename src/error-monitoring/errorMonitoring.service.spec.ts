import { CodedError } from '@/common/errors/codedError';
import { ErrorMonitoringService } from './errorMonitoring.service';
import {
  GatewayError,
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
    firstSeen: '2026-11-01T10:00:00.000Z',
    lastSeen: '2026-11-03T10:00:00.000Z',
    status: 'unresolved',
    ...overrides,
  };
}

describe('ErrorMonitoringService', () => {
  const listIssues = jest.fn();
  const getIssueDetail = jest.fn();
  let service: ErrorMonitoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ErrorMonitoringService(
      { listIssues, getIssueDetail } as unknown as SentryGateway,
      'vitaflow-backend',
      'vitaflow-frontend',
    );
  });

  describe('list', () => {
    it("UT-018 tags each project's issues with its app", async () => {
      listIssues.mockImplementation((projectSlug: string) =>
        Promise.resolve([
          makeIssue({
            id: projectSlug === 'vitaflow-backend' ? 'backend-1' : 'frontend-1',
          }),
        ]),
      );

      const result = await service.list();

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'backend-1', app: 'backend' }),
          expect.objectContaining({ id: 'frontend-1', app: 'frontend' }),
        ]),
      );
    });

    it('UT-019 throws CodedError(502, sentry_unavailable) when the gateway throws', async () => {
      listIssues.mockRejectedValue(new GatewayError('unavailable', 'down'));

      const error = await service.list().catch((err: unknown) => err);

      expect(error).toBeInstanceOf(CodedError);
      expect((error as CodedError).getStatus()).toBe(502);
      expect((error as CodedError).code).toBe('sentry_unavailable');
    });

    it('UT-026 returns { items: [] } when both projects are empty', async () => {
      listIssues.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual({ items: [] });
    });
  });

  describe('detail', () => {
    it('UT-020 returns the SentryIssueDetail from the gateway', async () => {
      const detail = { ...makeIssue(), stackTrace: 'at bar (foo.ts:10)' };
      getIssueDetail.mockResolvedValue(detail);

      const result = await service.detail('backend', 'issue-1');

      expect(result).toEqual(detail);
      expect(getIssueDetail).toHaveBeenCalledWith(
        'vitaflow-backend',
        'issue-1',
      );
    });

    it('UT-021 throws CodedError(404, issue_not_found) when the gateway throws "not_found"', async () => {
      getIssueDetail.mockRejectedValue(
        new GatewayError('not_found', 'missing'),
      );

      const error = await service
        .detail('frontend', 'missing-issue')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(CodedError);
      expect((error as CodedError).getStatus()).toBe(404);
      expect((error as CodedError).code).toBe('issue_not_found');
      expect(getIssueDetail).toHaveBeenCalledWith(
        'vitaflow-frontend',
        'missing-issue',
      );
    });
  });
});
