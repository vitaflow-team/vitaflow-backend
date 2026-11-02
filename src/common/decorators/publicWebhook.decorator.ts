import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_WEBHOOK = 'isPublicWebhook';

// Marks the one route ApiKeyGuard must let through without the shared
// secret: the Asaas webhook (educator-billing ADR-007). Asaas cannot send
// `x-application-secret`, and the route authenticates itself instead with
// the per-account webhook token. Matched by handler/class metadata, never
// by guessing at a route's path string — the same pattern as
// `AllowDuringViewAs` for `ViewAsWriteBlockGuard`.
export const PublicWebhook = () => SetMetadata(IS_PUBLIC_WEBHOOK, true);
