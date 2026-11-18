import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushPayload } from './types/pushPayload';
import { PushSubscriptionRecord } from './types/pushSubscriptionRecord';
import { SendResult } from './types/sendResult';

export const WEB_PUSH_TIMEOUT_MS = 5000;
const GONE_STATUSES = [404, 410];

// Thin wrapper over the `web-push` library so services depend on a small,
// fakeable surface (push-notifications ADR-005). Never logs endpoints, keys,
// or payload bodies.
@Injectable()
export class WebPushClient {
  private readonly logger = new Logger(WebPushClient.name);
  private readonly publicKey: string | null;

  constructor() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    const configured = [
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
      VAPID_SUBJECT,
    ].every((value) => typeof value === 'string' && value.trim().length > 0);
    this.publicKey = configured ? VAPID_PUBLIC_KEY!.trim() : null;
    if (configured) {
      webpush.setVapidDetails(
        VAPID_SUBJECT!.trim(),
        VAPID_PUBLIC_KEY!.trim(),
        VAPID_PRIVATE_KEY!.trim(),
      );
    } else {
      this.logger.log('push_disabled_unconfigured');
    }
  }

  isConfigured(): boolean {
    return this.publicKey !== null;
  }

  getPublicKey(): string | null {
    return this.publicKey;
  }

  async send(
    subscription: PushSubscriptionRecord,
    payload: PushPayload,
    ttlSeconds: number,
  ): Promise<SendResult> {
    if (!this.isConfigured()) return { ok: false, gone: false };
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: ttlSeconds, timeout: WEB_PUSH_TIMEOUT_MS },
      );
      return { ok: true };
    } catch (error) {
      return this.toFailure(error);
    }
  }

  private toFailure(error: unknown): SendResult {
    const status = (error as { statusCode?: number }).statusCode;
    const gone = status !== undefined && GONE_STATUSES.includes(status);
    this.logger.warn(`push_failed status=${status ?? 'none'} gone=${gone}`);
    return { ok: false, gone, status };
  }
}
