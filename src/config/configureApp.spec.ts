import { resolveCorsOrigins, resolveTrustProxy } from './configureApp';

describe('configureApp helpers', () => {
  describe('resolveCorsOrigins', () => {
    it('allows the frontend origin from APP_URL, without its path', () => {
      expect(
        resolveCorsOrigins({ APP_URL: 'https://app.vitaflow.com/some/path' }),
      ).toEqual(['https://app.vitaflow.com']);
    });

    it('adds deduplicated extra origins from CORS_ALLOWED_ORIGINS', () => {
      expect(
        resolveCorsOrigins({
          APP_URL: 'https://app.vitaflow.com',
          CORS_ALLOWED_ORIGINS:
            'https://www.vitaflow.com, https://app.vitaflow.com/',
        }),
      ).toEqual(['https://app.vitaflow.com', 'https://www.vitaflow.com']);
    });
  });

  describe('resolveTrustProxy', () => {
    it('trusts one hop in production and none elsewhere by default', () => {
      expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe(1);
      expect(resolveTrustProxy({ NODE_ENV: 'development' })).toBe(0);
      expect(resolveTrustProxy({})).toBe(0);
    });

    it('honours an explicit TRUST_PROXY_HOPS', () => {
      expect(
        resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }),
      ).toBe(2);
      expect(
        resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' }),
      ).toBe(0);
    });
  });
});
