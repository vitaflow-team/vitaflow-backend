import { Injectable } from '@nestjs/common';

// A thin seam so time-dependent logic (slot generation's "now" anchor,
// the reminder cron's due-window check) can be tested with a fixed instant
// instead of the real wall clock.
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
