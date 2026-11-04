import { GatewayError, SentryGateway } from './sentryGateway';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function rawIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-1',
    title: 'TypeError: Cannot read properties of undefined',
    culprit: 'src/foo.ts in bar',
    level: 'error',
    count: '3',
    firstSeen: '2026-11-01T10:00:00.000Z',
    lastSeen: '2026-11-03T10:00:00.000Z',
    status: 'unresolved',
    ...overrides,
  };
}

describe('SentryGateway', () => {
  describe('listIssues', () => {
    it('UT-001 returns the parsed SentryIssueSummary[] on a 200', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, [rawIssue()]));
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const result = await gateway.listIssues(
        'vitaflow-backend',
        'is:unresolved',
      );

      expect(result).toEqual([
        {
          id: 'issue-1',
          title: 'TypeError: Cannot read properties of undefined',
          culprit: 'src/foo.ts in bar',
          level: 'error',
          count: 3,
          firstSeen: '2026-11-01T10:00:00.000Z',
          lastSeen: '2026-11-03T10:00:00.000Z',
          status: 'unresolved',
        },
      ]);
    });

    it('UT-002 throws a GatewayError with kind "auth" on a 401', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(401, {}));
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const error = await gateway
        .listIssues('vitaflow-backend', 'is:unresolved')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).kind).toBe('auth');
    });

    it('UT-003 throws a GatewayError with kind "unavailable" on a 500', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const error = await gateway
        .listIssues('vitaflow-backend', 'is:unresolved')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).kind).toBe('unavailable');
      // retried READ_RETRIES times + the first attempt
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('UT-004 throws a GatewayError with kind "unavailable" when fetch aborts on timeout', async () => {
      const fetchImpl = jest.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      );
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        timeoutMs: 5,
        sleep: () => Promise.resolve(),
      });

      const error = await gateway
        .listIssues('vitaflow-backend', 'is:unresolved')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).kind).toBe('unavailable');
    });
  });

  describe('getIssueDetail', () => {
    it('UT-005 returns a SentryIssueDetail including a non-empty stackTrace on a 200', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, rawIssue()))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            entries: [
              {
                type: 'exception',
                data: {
                  values: [
                    {
                      stacktrace: {
                        frames: [
                          {
                            filename: 'src/foo.ts',
                            function: 'bar',
                            lineNo: 10,
                            colNo: 2,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const result = await gateway.getIssueDetail(
        'vitaflow-backend',
        'issue-1',
      );

      expect(result.id).toBe('issue-1');
      expect(result.stackTrace).not.toBe('');
      expect(result.stackTrace).toContain('bar');
    });

    it('UT-006 throws a GatewayError with kind "not_found" on a 404', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(404, {}));
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const error = await gateway
        .getIssueDetail('vitaflow-backend', 'issue-404')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).kind).toBe('not_found');
    });

    it('UT-027 returns stackTrace: "" rather than throwing when the latest event has no frames', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, rawIssue()))
        .mockResolvedValueOnce(jsonResponse(200, { entries: [] }));
      const gateway = new SentryGateway('org', 'token', {
        fetchImpl,
        sleep: () => Promise.resolve(),
      });

      const result = await gateway.getIssueDetail(
        'vitaflow-backend',
        'issue-1',
      );

      expect(result.stackTrace).toBe('');
    });
  });
});
