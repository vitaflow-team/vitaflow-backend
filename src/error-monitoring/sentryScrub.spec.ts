import type { ErrorEvent } from '@sentry/node';
import { beforeSend } from './sentryScrub';

describe('sentryScrub beforeSend', () => {
  it('UT-011 strips request.data to undefined', () => {
    const event = {
      request: { data: { weightKg: 80, email: 'user@example.com' } },
    } as unknown as ErrorEvent;

    const result = beforeSend(event);

    expect(result.request?.data).toBeUndefined();
  });

  it('UT-012 strips request.cookies and request.headers to undefined', () => {
    const event = {
      request: {
        cookies: { session: 'abc' },
        headers: { authorization: 'Bearer token' },
      },
    } as unknown as ErrorEvent;

    const result = beforeSend(event);

    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers).toBeUndefined();
  });

  it('UT-013 strips the whole request.data body, not just a field named weightKg', () => {
    const event = {
      request: {
        data: { weightKg: 80, note: 'unrelated field' },
      },
    } as unknown as ErrorEvent;

    const result = beforeSend(event);

    expect(result.request).not.toHaveProperty('data');
  });

  it('is a no-op when the event has no request at all', () => {
    const event = {} as unknown as ErrorEvent;

    const result = beforeSend(event);

    expect(result).toEqual({});
  });
});
