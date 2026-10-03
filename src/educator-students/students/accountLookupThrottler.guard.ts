import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Rate-limits the account lookup per authenticated educator, so the e-mail
// lookup cannot be used to probe which addresses have accounts. Keyed by the
// caller's id (not by IP or by the probed e-mail), so one educator cannot
// spread a probe across addresses to dodge the limit. Must run after
// AuthGuard, which populates `req.user`.
@Injectable()
export class AccountLookupThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const userId = (req.user as { id?: string } | undefined)?.id;
    const tracker = userId
      ? `educator-lookup:${userId}`
      : `ip:${String(req.ip ?? 'unknown')}`;
    return Promise.resolve(tracker);
  }
}
