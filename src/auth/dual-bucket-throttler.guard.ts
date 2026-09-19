import { Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { createHash } from 'crypto';

@Injectable()
export class DualBucketThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    try {
      const body = req.body;
      if (body && typeof body === 'object') {
        const email = (body as Record<string, unknown>).email;
        if (typeof email === 'string' && email.trim()) {
          return Promise.resolve(`identity:${email.trim().toLowerCase()}`);
        }

        const idToken = (body as Record<string, unknown>).idToken;
        if (typeof idToken === 'string' && idToken.trim()) {
          const digest = createHash('sha256').update(idToken).digest('hex');
          return Promise.resolve(`identity-token:${digest}`);
        }
      }
    } catch {
      // A malformed body deliberately falls through to IP-only tracking.
    }

    return Promise.resolve(this.ipTracker(req));
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration, generateKey } =
      props;
    const { req, res } = this.getRequestResponse(context);
    const trackers = new Set([this.ipTracker(req), await this.getTracker(req)]);
    const throttlerName = throttler.name ?? 'default';

    for (const tracker of trackers) {
      const key = generateKey(context, tracker, throttlerName);
      const result = await this.storageService.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );

      if (result.isBlocked) {
        if (res && typeof res.header === 'function') {
          res.header('Retry-After', result.timeToBlockExpire);
        }
        const detail: ThrottlerLimitDetail = {
          limit,
          ttl,
          key,
          tracker,
          ...result,
        };
        await this.throwThrottlingException(context, detail);
      }
    }

    return true;
  }

  private ipTracker(req: Record<string, unknown>): string {
    const socket = req.socket as { remoteAddress?: string } | undefined;
    const ip =
      (typeof req.ip === 'string' && req.ip) ||
      socket?.remoteAddress ||
      'unknown';
    return `ip:${ip}`;
  }
}
