// SentryGateway is constructed once via a factory provider (org slug + API
// token from ConfigService.getOrThrow, ADR-004 Implementation Notes),
// mirroring the PLATFORM_ASAAS_API_KEY/PAYMENT_GATEWAY token pattern.
export const SENTRY_GATEWAY = Symbol('SENTRY_GATEWAY');
