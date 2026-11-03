---
name: vitaflow-llm-calls
description: Apply vitaflow-backend's retry and error-handling pattern (single retry layer, 429-vs-quota distinction, logging before converting, CodedError) whenever writing or reviewing a call to an LLM/OpenAI API in vitaflow-backend — currently the workout generator, and the pattern to reuse for any future LLM feature (e.g. meal-plan generation). Not for other third-party API calls.
---

# Vitaflow LLM Calls

`src/workouts/` (rule-engine + LLM conversational intake, ADR-012) shipped five separate fix PRs (#59–#63) against this exact pattern before it stabilized — read this first for any new LLM call, backend- or feature-wise.

## 1. One retry layer only

The OpenAI SDK retries on its own by default. If the service also retries (`withRetry`), both layers stack: 3×3 = up to 9 HTTP calls per request, the SDK's own list including 429 — amplifying the exact rate-limit pressure the service's retry was meant to absorb. Disable the SDK's retries at the client provider (`maxRetries: 0`) and let the service's `withRetry` be the single policy.

## 2. Classify before retrying

A fixed attempt count with exponential backoff (e.g. 3 attempts, `[500, 1500]` ms) is for transient failures only:

- Retry a `5xx` and a `429` **except** when that 429 is `insufficient_quota` (OpenAI's billing-exhausted response, `code: 'credit_balance_exhausted'`) — that one is permanent until the account is topped up, so retrying it 3× just reproduces the same rejection 3× for nothing.
- Fail immediately on any other `4xx` (bad request, invalid key) — same reasoning.

```ts
private isClientError(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (typeof error.status !== 'number') return false;
  if (error.status === 429) return error.type === 'insufficient_quota';
  return error.status >= 400 && error.status < 500;
}
```

## 3. Log the real error, then convert it

Before converting a failed call to the generic client-facing message, log the upstream error's status, code, type, and message. Without this, a `502` in production is undiagnosable — the client only ever sees the safe fallback copy.

## 4. Fail with `CodedError`, not `AppError`

An LLM call failure needs a stable `code` (e.g. `'llm_call_failed'`) so the frontend's `ErrorMapping` (`vitaflow-frontend-conventions` §6) can map it to safe copy distinct from other failures sharing the same status — `AppError.reason` can't do this since it's never sent to the client. See `vitaflow-backend-conventions` §7.

## 5. Build the request once, outside the retry closure

A retried attempt resends the same request; it never re-derives it. Build the full request object (messages, `response_format`/`json_schema`) before calling `withRetry`, so prompt-building work doesn't scale with the attempt count.

Done when a new LLM call reuses `withRetry`/`isClientError`, throws `CodedError` on final failure, and logs the real upstream error before converting it.
