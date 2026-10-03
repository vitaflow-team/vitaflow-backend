import {
  FixedTimesRepository,
  SessionData,
} from '@/repositories/fixed-times/fixedTimes.repository';
import { Injectable, Logger } from '@nestjs/common';
import { FixedTime } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../clock.service';
import { FIXED_MATERIALIZE_DAYS } from './fixedTime.constants';
import {
  brtDateKey,
  findEarliestConflict,
  occurrencesBetween,
  OccupancyRow,
  TimeRange,
} from './fixedTime.util';

export interface RenewalSummary {
  fixedTimes: number;
  created: number;
  skipped: number;
  conflicts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps every fixed time materialized up to 35 days ahead (ADR-006). It runs
 * daily at 03:00 in Brasília. Each rule is renewed under its educator's lock
 * and is idempotent: dates that already have a row, canceled dates and dates
 * a booking now covers are left alone, the last ones logged as conflicts.
 */
@Injectable()
export class FixedSessionsRenewalService {
  private readonly logger = new Logger(FixedSessionsRenewalService.name);

  constructor(
    private readonly repo: FixedTimesRepository,
    private readonly clock: Clock,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async runRenewal(): Promise<RenewalSummary> {
    const now = this.clock.now();
    const until = new Date(now.getTime() + FIXED_MATERIALIZE_DAYS * DAY_MS);
    const rules = await this.repo.findAllRules();

    const summary: RenewalSummary = {
      fixedTimes: rules.length,
      created: 0,
      skipped: 0,
      conflicts: 0,
    };
    for (const rule of rules) {
      const part = await this.renewRule(rule, now, until);
      summary.created += part.created;
      summary.skipped += part.skipped;
      summary.conflicts += part.conflicts;
    }

    this.logger.log(
      `fixed_renewal_run fixedTimes=${summary.fixedTimes} created=${summary.created} skipped=${summary.skipped} conflicts=${summary.conflicts}`,
    );
    return summary;
  }

  private async renewRule(
    rule: FixedTime,
    now: Date,
    until: Date,
  ): Promise<{ created: number; skipped: number; conflicts: number }> {
    return await this.repo.withEducatorLock(rule.professionalId, async (tx) => {
      const existing = await this.repo.findRuleSessionsBetween(
        rule.id,
        { startAt: now, endAt: until },
        tx,
      );
      const covered = new Set(existing.map((row) => brtDateKey(row.startAt)));
      const candidates = occurrencesBetween(rule, now, until, covered);
      const occupancy: OccupancyRow[] = candidates.length
        ? await this.repo.findOccupancy(
            rule.professionalId,
            window(candidates),
            tx,
          )
        : [];

      const rows: SessionData[] = [];
      let conflicts = 0;
      for (const range of candidates) {
        const conflict = findEarliestConflict([range], occupancy, rule.id);
        if (conflict) {
          conflicts += 1;
          this.logger.log(
            `fixed_session_conflict_skipped fixedTimeId=${rule.id}`,
          );
          continue;
        }
        rows.push(sessionRow(rule, range));
      }

      const created = await this.repo.createSessionsSkippingDuplicates(
        rows,
        tx,
      );
      return { created, skipped: covered.size, conflicts };
    });
  }
}

function window(ranges: TimeRange[]): TimeRange {
  return {
    startAt: new Date(
      Math.min(...ranges.map((range) => range.startAt.getTime())),
    ),
    endAt: new Date(Math.max(...ranges.map((range) => range.endAt.getTime()))),
  };
}

function sessionRow(rule: FixedTime, range: TimeRange): SessionData {
  return {
    ...range,
    fixedTimeId: rule.id,
    clientId: rule.clientId,
    professionalId: rule.professionalId,
    type: rule.type,
    onlineLink: rule.onlineLink,
    workoutLetter: rule.workoutLetter,
  };
}
