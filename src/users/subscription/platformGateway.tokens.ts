// Vita Flow's own Asaas account (ADR-010 decision 2) — a separate
// credential from any professional's connected account (ADR-001/ADR-007),
// so these are plain env-sourced DI tokens, not encrypted-at-rest rows
// (there is only ever one of each, same trust model the removed
// `STRIPE_API_KEY` had).
export const PLATFORM_ASAAS_API_KEY = Symbol('PLATFORM_ASAAS_API_KEY');
export const PLATFORM_WEBHOOK_TOKEN = Symbol('PLATFORM_WEBHOOK_TOKEN');
