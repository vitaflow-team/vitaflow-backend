import { CodedError } from '@/common/errors/codedError';
import { AppError } from '@/utils/app.erro';
import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

const SERVER_ERROR_THRESHOLD = 500;

// Only an AppError/CodedError carrying a 4xx status is a deliberate
// business-rule rejection (ADR-002 of the PRD) — everything else (a plain
// unhandled Error, or an AppError/CodedError deliberately thrown with a 5xx
// status) is genuinely unexpected and must reach Sentry.
function isExpectedRejection(exception: unknown): boolean {
  if (exception instanceof AppError || exception instanceof CodedError) {
    return exception.getStatus() < SERVER_ERROR_THRESHOLD;
  }
  return false;
}

// Global exception filter (registered as an APP_FILTER provider in
// app.module.ts) that forwards every genuinely unexpected failure to
// Sentry.captureException. It only *observes*: extending BaseExceptionFilter
// and delegating to `super.catch()` means NestJS's default
// exception-to-response mapping (and every existing guard/pipe's own error
// shape) is completely unchanged — this filter never produces its own HTTP
// response.
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isExpectedRejection(exception)) {
      Sentry.captureException(exception);
      const name = exception instanceof Error ? exception.name : 'unknown';
      this.logger.error(`sentry_capture_forwarded error=${name}`);
    }

    super.catch(exception as Error, host);
  }
}
