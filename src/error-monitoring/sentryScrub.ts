import type { ErrorEvent } from '@sentry/node';

// ADR-006's second, independent layer behind the SDK's own `dataCollection`
// init options (the Sentry Node SDK's current replacement for the older
// `sendDefaultPii` flag — see src/main.ts) — strips the whole request
// body/cookies/headers unconditionally, never a field-by-field denylist, so
// a forgotten field name can never leak health data or credentials into
// Sentry. Shared by Sentry.init()'s `beforeSend` hook — the hint parameter
// is unused, so it's simply omitted (a function with fewer parameters is
// assignable to the hook's two-parameter type).
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
  }
  return event;
}
