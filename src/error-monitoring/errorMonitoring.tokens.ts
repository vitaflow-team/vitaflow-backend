// Plain env-sourced DI tokens for the values ErrorMonitoringService and
// NewIssueAlertCron consume directly (as opposed to SENTRY_ORG_SLUG/
// SENTRY_API_TOKEN, which are only ever used to construct SentryGateway and
// so are folded into its own factory provider) — same
// PLATFORM_ASAAS_API_KEY/PLATFORM_WEBHOOK_TOKEN pattern as
// src/users/subscription/platformGateway.tokens.ts.
export const SENTRY_BACKEND_PROJECT_SLUG = Symbol(
  'SENTRY_BACKEND_PROJECT_SLUG',
);
export const SENTRY_FRONTEND_PROJECT_SLUG = Symbol(
  'SENTRY_FRONTEND_PROJECT_SLUG',
);
export const ERROR_ALERT_EMAIL = Symbol('ERROR_ALERT_EMAIL');
