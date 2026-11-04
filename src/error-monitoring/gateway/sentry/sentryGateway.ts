const REQUEST_TIMEOUT_MS = 10_000;
const READ_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;
const SENTRY_API_BASE_URL = 'https://sentry.io/api/0';

export type GatewayErrorKind = 'auth' | 'not_found' | 'unavailable';

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface SentryIssueSummary {
  id: string;
  title: string;
  culprit: string;
  level: 'error' | 'fatal';
  count: number;
  firstSeen: string; // ISO 8601
  lastSeen: string;
  status: 'unresolved' | 'resolved' | 'ignored';
}

export interface SentryIssueDetail extends SentryIssueSummary {
  stackTrace: string;
}

interface SentryRequest {
  method: 'GET';
  path: string;
  retryable: boolean;
}

interface SentryGatewayOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

interface RawSentryIssue {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  count: string | number;
  firstSeen: string;
  lastSeen: string;
  status: string;
}

interface RawSentryEvent {
  entries?: Array<{
    type: string;
    data?: { values?: Array<{ stacktrace?: { frames?: RawSentryFrame[] } }> };
  }>;
}

interface RawSentryFrame {
  filename?: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapIssue(raw: RawSentryIssue): SentryIssueSummary {
  return {
    id: raw.id,
    title: raw.title,
    culprit: raw.culprit ?? '',
    level: raw.level === 'fatal' ? 'fatal' : 'error',
    count: Number(raw.count),
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    status:
      raw.status === 'resolved' || raw.status === 'ignored'
        ? raw.status
        : 'unresolved',
  };
}

function extractStackTrace(event: RawSentryEvent): string {
  const exceptionEntry = event.entries?.find(
    (entry) => entry.type === 'exception',
  );
  const frames = exceptionEntry?.data?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length === 0) return '';

  return frames
    .map((frame) => {
      const location = [frame.filename, frame.lineNo, frame.colNo]
        .filter((part) => part !== undefined && part !== null)
        .join(':');
      return `${frame.function ?? '<anonymous>'} (${location})`;
    })
    .join('\n');
}

// Reads Sentry's REST API for the backoffice error-monitoring screen and the
// new-issue alert cron (ADR-004: Sentry is the only store, queried live on
// every call — no local mirror). Mirrors AsaasGateway's shape exactly:
// AbortController timeout, retry only idempotent reads with exponential
// backoff, map every failure to a typed GatewayError, never leak a raw
// Sentry HTTP error upward.
export class SentryGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(
    private readonly orgSlug: string,
    private readonly apiToken: string,
    options: SentryGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? delay;
    this.baseUrl = options.baseUrl ?? SENTRY_API_BASE_URL;
  }

  async listIssues(
    projectSlug: string,
    query: string,
  ): Promise<SentryIssueSummary[]> {
    const raw = await this.call<RawSentryIssue[]>({
      method: 'GET',
      path: `/projects/${this.orgSlug}/${projectSlug}/issues/?query=${encodeURIComponent(query)}`,
      retryable: true,
    });
    return raw.map(mapIssue);
  }

  async getIssueDetail(
    projectSlug: string,
    issueId: string,
  ): Promise<SentryIssueDetail> {
    const issue = await this.call<RawSentryIssue>({
      method: 'GET',
      path: `/projects/${this.orgSlug}/${projectSlug}/issues/${issueId}/`,
      retryable: true,
    });
    const latestEvent = await this.call<RawSentryEvent>({
      method: 'GET',
      path: `/projects/${this.orgSlug}/${projectSlug}/issues/${issueId}/events/latest/`,
      retryable: true,
    });

    return {
      ...mapIssue(issue),
      stackTrace: extractStackTrace(latestEvent),
    };
  }

  private async call<T>(request: SentryRequest): Promise<T> {
    const attempts = request.retryable ? READ_RETRIES + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.send<T>(request);
      } catch (error) {
        const retryable =
          error instanceof GatewayError && error.kind === 'unavailable';
        if (!retryable || attempt === attempts - 1) throw error;
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
    throw new GatewayError(
      'unavailable',
      'O Sentry está indisponível no momento.',
    );
  }

  private async send<T>(request: SentryRequest): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: { Authorization: `Bearer ${this.apiToken}` },
        signal: controller.signal,
      });
    } catch {
      throw new GatewayError(
        'unavailable',
        'O Sentry está indisponível no momento.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403)
      throw new GatewayError('auth', 'O token da API do Sentry foi recusado.');
    if (response.status === 404)
      throw new GatewayError('not_found', 'Registro não encontrado no Sentry.');
    if (response.status >= 400)
      throw new GatewayError(
        'unavailable',
        'O Sentry está indisponível no momento.',
      );

    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }
}
