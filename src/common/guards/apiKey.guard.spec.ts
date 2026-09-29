import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { timingSafeEqual } from 'crypto';
import { ApiKeyGuard, secretsMatch } from './apiKey.guard';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  const mockConfigService = {
    get: jest.fn(),
  };

  const createMockExecutionContext = (headers: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    } as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true if secrets match', () => {
    mockConfigService.get.mockReturnValue('my-secret');
    const context = createMockExecutionContext({
      'x-application-secret': 'my-secret',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException if secrets do not match', () => {
    mockConfigService.get.mockReturnValue('my-secret');
    const context = createMockExecutionContext({
      'x-application-secret': 'wrong-secret',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if header is missing', () => {
    mockConfigService.get.mockReturnValue('my-secret');
    const context = createMockExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if server secret is missing', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const context = createMockExecutionContext({
      'x-application-secret': 'any-secret',
    });

    // Mock console.error to avoid noise in test output
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Server misconfiguration: missing secret'),
    );
  });

  it('should throw ForbiddenException for a repeated (array) header', () => {
    mockConfigService.get.mockReturnValue('my-secret');
    const context = createMockExecutionContext({
      'x-application-secret': ['my-secret', 'my-secret'],
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('secretsMatch (US-005)', () => {
  const realSecret = 'real-application-secret';

  it('UT-006 matches the real secret and rejects a value one character off', () => {
    expect(secretsMatch(realSecret, realSecret)).toBe(true);
    expect(secretsMatch('real-application-secreT', realSecret)).toBe(false);
  });

  it('UT-006 compares with timingSafeEqual over equal-length buffers, even for a shorter value', () => {
    const compare = timingSafeEqual as jest.MockedFunction<
      typeof timingSafeEqual
    >;
    compare.mockClear();

    expect(secretsMatch('short', realSecret)).toBe(false);

    expect(compare).toHaveBeenCalledTimes(1);
    const [provided, expected] = compare.mock.calls[0] as [Buffer, Buffer];
    expect(provided.length).toBe(expected.length);
  });

  it('UT-007 rejects a non-string header value without throwing', () => {
    expect(() => secretsMatch(['a', 'b'], realSecret)).not.toThrow();
    expect(secretsMatch(['a', 'b'], realSecret)).toBe(false);
    expect(secretsMatch([realSecret], realSecret)).toBe(false);
    expect(secretsMatch(undefined, realSecret)).toBe(false);
  });
});
