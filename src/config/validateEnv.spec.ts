import { validateEnv } from './validateEnv';

const requiredEnv = {
  JWT_SECRET: 'a-jwt-secret-that-is-at-least-32-chars',
  DATABASE_URL: 'postgresql://localhost/test',
  APPLICATION_SECRET: 'application-secret',
  STRIPE_API_KEY: 'sk_test_key',
  OPENAI_API_KEY: 'sk-test-key',
  APP_URL: 'http://localhost:3000',
  GCP_PROJECT_ID: 'test-project',
  GCP_CLIENT_EMAIL: 'storage@test-project.iam.gserviceaccount.com',
  GCP_PRIVATE_KEY: 'test-private-key',
  GCP_BUCKET: 'test-bucket',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '465',
  MAIL_USER: 'mailer@example.com',
  MAIL_PASS: 'mail-password',
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

  it('names a missing Stripe secret key', () => {
    expect(() => validateEnv({ ...requiredEnv, STRIPE_API_KEY: '  ' })).toThrow(
      'STRIPE_API_KEY',
    );
  });

  it('names a missing OpenAI secret key', () => {
    expect(() => validateEnv({ ...requiredEnv, OPENAI_API_KEY: '  ' })).toThrow(
      'OPENAI_API_KEY',
    );
  });

  describe('UT-001 fail-fast configuration (platform-hardening)', () => {
    it('rejects an unset or empty JWT_SECRET', () => {
      expect(() =>
        validateEnv({ ...requiredEnv, JWT_SECRET: undefined }),
      ).toThrow('Missing required environment variable: JWT_SECRET');
      expect(() => validateEnv({ ...requiredEnv, JWT_SECRET: '' })).toThrow(
        'JWT_SECRET',
      );
    });

    it('rejects a 10-character JWT_SECRET without echoing it', () => {
      const weak = 'short-1234';

      const error = (() => {
        try {
          validateEnv({ ...requiredEnv, JWT_SECRET: weak });
        } catch (caught) {
          return caught as Error;
        }
      })();

      expect(error?.message).toContain('JWT_SECRET');
      expect(error?.message).toContain('32');
      expect(error?.message).not.toContain(weak);
    });

    it('accepts a JWT_SECRET of exactly 32 characters', () => {
      expect(() =>
        validateEnv({ ...requiredEnv, JWT_SECRET: 'x'.repeat(32) }),
      ).not.toThrow();
      expect(() =>
        validateEnv({ ...requiredEnv, JWT_SECRET: 'x'.repeat(31) }),
      ).toThrow('JWT_SECRET');
    });

    it.each([
      'APP_URL',
      'GCP_PROJECT_ID',
      'GCP_CLIENT_EMAIL',
      'GCP_PRIVATE_KEY',
      'GCP_BUCKET',
      'MAIL_HOST',
      'MAIL_PORT',
      'MAIL_USER',
      'MAIL_PASS',
    ])('names a missing %s', (variable) => {
      expect(() =>
        validateEnv({ ...requiredEnv, [variable]: undefined }),
      ).toThrow(`Missing required environment variable: ${variable}`);
    });

    it('rejects a non-URL APP_URL or CORS_ALLOWED_ORIGINS entry', () => {
      expect(() =>
        validateEnv({ ...requiredEnv, APP_URL: 'localhost:3000' }),
      ).toThrow('APP_URL');
      expect(() =>
        validateEnv({
          ...requiredEnv,
          CORS_ALLOWED_ORIGINS: 'https://a.example.com, not a url',
        }),
      ).toThrow('CORS_ALLOWED_ORIGINS');
    });

    it('rejects a TRUST_PROXY_HOPS that is not a non-negative integer', () => {
      expect(() =>
        validateEnv({ ...requiredEnv, TRUST_PROXY_HOPS: 'true' }),
      ).toThrow('TRUST_PROXY_HOPS');
      expect(() =>
        validateEnv({ ...requiredEnv, TRUST_PROXY_HOPS: '2' }),
      ).not.toThrow();
    });
  });
});
