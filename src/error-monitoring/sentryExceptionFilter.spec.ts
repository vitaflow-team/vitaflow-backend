import { CodedError } from '@/common/errors/codedError';
import { AppError } from '@/utils/app.erro';
import { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryExceptionFilter } from './sentryExceptionFilter';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

// A stub HttpAdapter (BaseExceptionFilter's constructor parameter) so
// `super.catch()` can produce a response without a real Nest app bootstrapped.
function makeHost(): ArgumentsHost {
  const response = { end: jest.fn() };
  const request = {};
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getArgByIndex: (index: number) => (index === 1 ? response : request),
  } as unknown as ArgumentsHost;
}

function makeFilter(): SentryExceptionFilter {
  const applicationRef = {
    isHeadersSent: () => false,
    reply: jest.fn(),
    end: jest.fn(),
  };
  return new SentryExceptionFilter(
    applicationRef as unknown as ConstructorParameters<
      typeof SentryExceptionFilter
    >[0],
  );
}

describe('SentryExceptionFilter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('UT-007 does not forward an AppError with statusCode 400', () => {
    const exception = new AppError('Validação falhou.', 400);

    makeFilter().catch(exception, makeHost());

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('UT-008 does not forward a CodedError with statusCode 404', () => {
    const exception = new CodedError('Não encontrado.', 404, 'not_found');

    makeFilter().catch(exception, makeHost());

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('UT-009 forwards a plain unhandled Error', () => {
    const exception = new Error('boom');

    makeFilter().catch(exception, makeHost());

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });

  it('UT-010 forwards a CodedError with statusCode 500', () => {
    const exception = new CodedError('Falha interna.', 500, 'internal_error');

    makeFilter().catch(exception, makeHost());

    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });
});
