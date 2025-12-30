import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyGuard } from './api-key.guard';

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
});
