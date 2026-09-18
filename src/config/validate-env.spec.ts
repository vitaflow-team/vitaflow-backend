import { validateEnv } from './validate-env';

const requiredEnv = {
  JWT_SECRET: 'jwt-secret',
  DATABASE_URL: 'postgresql://localhost/test',
  APPLICATION_SECRET: 'application-secret',
};

describe('validateEnv', () => {
  it('UT-040 accepts required variables with both Google credentials', () => {
    expect(() =>
      validateEnv({
        ...requiredEnv,
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
      }),
    ).not.toThrow();
  });

  it('UT-041 accepts required variables with Google intentionally disabled', () => {
    expect(() => validateEnv(requiredEnv)).not.toThrow();
  });

  it('UT-042 names the missing Google credential for partial config', () => {
    expect(() =>
      validateEnv({ ...requiredEnv, GOOGLE_CLIENT_ID: 'google-client-id' }),
    ).toThrow('GOOGLE_CLIENT_SECRET');
  });

  it('UT-043 names a missing non-Google required variable', () => {
    expect(() =>
      validateEnv({ ...requiredEnv, JWT_SECRET: undefined }),
    ).toThrow('JWT_SECRET');
  });
});
