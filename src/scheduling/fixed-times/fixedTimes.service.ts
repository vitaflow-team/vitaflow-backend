import { CodedError } from '@/common/errors/codedError';
import { findOwnedStudent } from '@/educator-students/students/studentOwnership.util';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import {
  FixedTimeData,
  FixedTimeRuleFields,
  FixedTimesRepository,
  SessionData,
  Tx,
} from '@/repositories/fixed-times/fixedTimes.repository';
import { Injectable } from '@nestjs/common';
import { Client, FixedTime, SessionType, Slot } from '@prisma/client';
import { Clock } from '../clock.service';
import {
  FIXED_DISPLAY_DAYS,
  FIXED_DURATION_DEFAULT_MINUTES,
  FIXED_MATERIALIZE_DAYS,
  FIXED_TIME_LIMIT_PER_STUDENT,
  FIXED_TIME_NOT_FOUND,
} from './fixedTime.constants';
import {
  brtDateKey,
  Conflict,
  findEarliestConflict,
  FixedTimeRule,
  occurrencesBetween,
  resolveLetter,
  RuleProblem,
  TimeRange,
  validateRule,
} from './fixedTime.util';
import { FixedTimeNotificationsService } from './fixedTimeNotifications.service';
import {
  FixedTimeResponseDTO,
  StudentScheduleResponseDTO,
  UpcomingScheduleItemDTO,
} from '@/educator-students/schedule/dto/fixedTimeResponse.Dto';
import { CreateFixedTimeDTO } from '@/educator-students/schedule/dto/createFixedTime.Dto';
import { UpdateFixedTimeDTO } from '@/educator-students/schedule/dto/updateFixedTime.Dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields a rule is compared and stored by. */
type RuleValues = FixedTimeRule;

function toRuleValues(row: FixedTime): RuleValues {
  return {
    weekday: row.weekday,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    type: row.type,
    onlineLink: row.onlineLink,
    workoutLetter: row.workoutLetter,
  };
}

function horizon(now: Date, days: number): TimeRange {
  return { startAt: now, endAt: new Date(now.getTime() + days * DAY_MS) };
}

/**
 * The educator's fixed weekly times for one student (ADR-002, ADR-003). Every
 * write runs under the educator's lock, checks conflicts against the whole
 * agenda and changes only future sessions that have not started. A notice to
 * the student follows each committed change.
 */
@Injectable()
export class FixedTimesService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly repo: FixedTimesRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly notices: FixedTimeNotificationsService,
    private readonly clock: Clock,
  ) {}

  async list(
    educatorId: string,
    studentId: string,
  ): Promise<StudentScheduleResponseDTO> {
    const client = await findOwnedStudent(this.clients, educatorId, studentId);
    const names = await this.activeSessionNames(client.id);
    const now = this.clock.now();
    const window = horizon(now, FIXED_DISPLAY_DAYS);

    const rules = await this.repo.findRulesByClient(client.id);
    const sessions = await this.repo.findClientSessions(client.id, window);
    const booked = client.userId
      ? await this.repo.findBookedForUser(educatorId, client.userId, window)
      : [];

    return {
      fixedTimes: rules.map((rule) => this.toFixedTimeDTO(rule, names)),
      upcoming: [
        ...sessions.map((row) => this.fixedUpcoming(row, names)),
        ...booked.map((row) => this.bookingUpcoming(row)),
      ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    };
  }

  async create(
    educatorId: string,
    studentId: string,
    dto: CreateFixedTimeDTO,
  ): Promise<FixedTimeResponseDTO> {
    const client = await findOwnedStudent(this.clients, educatorId, studentId);
    const rule = this.normalize(dto);
    this.assertValid(rule);

    const created = await this.repo.withEducatorLock(educatorId, async (tx) => {
      const count = await this.repo.countRulesByClient(client.id, tx);
      if (count >= FIXED_TIME_LIMIT_PER_STUDENT) {
        throw new CodedError(
          `Um aluno pode ter no máximo ${FIXED_TIME_LIMIT_PER_STUDENT} horários fixos.`,
          409,
          'fixed_time_limit',
        );
      }

      const now = this.clock.now();
      const ranges = occurrencesBetween(
        rule,
        now,
        horizon(now, FIXED_MATERIALIZE_DAYS).endAt,
      );
      await this.assertNoConflict(tx, educatorId, ranges);

      const row = await this.repo.createRule(
        this.ruleData(client, educatorId, rule),
        tx,
      );
      await this.repo.createSessions(this.sessionRows(row, ranges), tx);
      return row;
    });

    await this.notices.notify({
      educatorId,
      userId: client.userId,
      kind: 'created',
      rule,
    });
    return this.toFixedTimeDTO(
      created,
      await this.activeSessionNames(client.id),
    );
  }

  async update(
    educatorId: string,
    studentId: string,
    fixedTimeId: string,
    dto: UpdateFixedTimeDTO,
  ): Promise<FixedTimeResponseDTO> {
    const client = await findOwnedStudent(this.clients, educatorId, studentId);
    const outcome = await this.repo.withEducatorLock(educatorId, async (tx) => {
      const existing = await this.requireRule(client.id, fixedTimeId, tx);
      const merged = this.merge(existing, dto);
      this.assertValid(merged);

      const changed = this.changedFields(toRuleValues(existing), merged);
      if (changed.length === 0)
        return { row: existing, changed: false, merged };

      const now = this.clock.now();
      if (
        changed.some((field) =>
          ['weekday', 'startMinute', 'durationMinutes'].includes(field),
        )
      ) {
        await this.regenerate(tx, educatorId, existing, merged, now);
      } else {
        await this.updateInPlace(tx, existing, merged, now);
      }
      const row = await this.repo.updateRule(
        fixedTimeId,
        this.ruleFields(merged),
        tx,
      );
      return { row, changed: true, merged };
    });

    if (outcome.changed) {
      await this.notices.notify({
        educatorId,
        userId: client.userId,
        kind: 'changed',
        rule: outcome.merged,
      });
    }
    return this.toFixedTimeDTO(
      outcome.row,
      await this.activeSessionNames(client.id),
    );
  }

  async remove(
    educatorId: string,
    studentId: string,
    fixedTimeId: string,
  ): Promise<void> {
    const client = await findOwnedStudent(this.clients, educatorId, studentId);
    const removed = await this.repo.withEducatorLock(educatorId, async (tx) => {
      const rule = await this.requireRule(client.id, fixedTimeId, tx);
      const now = this.clock.now();

      const future = await this.repo.findFutureSessions(fixedTimeId, now, tx);
      await this.repo.deleteSessions(
        future.map((row) => row.id),
        tx,
      );
      await this.repo.detachStartedSessions(fixedTimeId, now, tx);
      await this.repo.deleteRule(fixedTimeId, tx);
      return rule;
    });

    await this.notices.notify({
      educatorId,
      userId: client.userId,
      kind: 'removed',
      rule: toRuleValues(removed),
    });
  }

  /** Canceled dates of the rule are skipped; scheduled ones are rebuilt from the new rule. */
  private async regenerate(
    tx: Tx,
    educatorId: string,
    existing: FixedTime,
    merged: RuleValues,
    now: Date,
  ): Promise<void> {
    const future = await this.repo.findFutureSessions(existing.id, now, tx);
    const fresh = occurrencesBetween(
      merged,
      now,
      horizon(now, FIXED_MATERIALIZE_DAYS).endAt,
    );
    const freshDates = new Set(fresh.map((range) => brtDateKey(range.startAt)));

    // A canceled date (Brasília calendar date) that is still an occurrence of
    // the new rule stays canceled, at whatever time the new rule uses; any
    // other canceled marker of the old rule is dropped.
    const keptCanceled = future.filter(
      (row) =>
        row.status === 'CANCELED' && freshDates.has(brtDateKey(row.startAt)),
    );
    const keptIds = new Set(keptCanceled.map((row) => row.id));
    await this.repo.deleteSessions(
      future.filter((row) => !keptIds.has(row.id)).map((row) => row.id),
      tx,
    );

    const skip = new Set(keptCanceled.map((row) => brtDateKey(row.startAt)));
    const toCreate = fresh.filter(
      (range) => !skip.has(brtDateKey(range.startAt)),
    );
    await this.assertNoConflict(tx, educatorId, toCreate, existing.id);
    await this.repo.createSessions(
      this.sessionRows(
        { ...existing, ...this.ruleFields(merged) } as FixedTime,
        toCreate,
      ),
      tx,
    );
  }

  /** Only type, link and letter changed: future scheduled sessions follow in place. */
  private async updateInPlace(
    tx: Tx,
    existing: FixedTime,
    merged: RuleValues,
    now: Date,
  ): Promise<void> {
    const linkChanged = existing.onlineLink !== merged.onlineLink;
    const fields = {
      type: merged.type,
      workoutLetter: merged.workoutLetter,
    };
    await this.repo.updateFutureScheduled(existing.id, now, fields, {}, tx);
    if (linkChanged || merged.type === SessionType.PRESENCIAL) {
      // A session whose link was set on its own keeps it: only the rule's
      // previous link is replaced.
      await this.repo.updateFutureScheduled(
        existing.id,
        now,
        { onlineLink: merged.onlineLink },
        { onlineLink: existing.onlineLink },
        tx,
      );
    }
  }

  private async assertNoConflict(
    tx: Tx,
    educatorId: string,
    ranges: TimeRange[],
    ignoreFixedTimeId?: string,
  ): Promise<void> {
    if (ranges.length === 0) return;
    const window = {
      startAt: new Date(
        Math.min(...ranges.map((range) => range.startAt.getTime())),
      ),
      endAt: new Date(
        Math.max(...ranges.map((range) => range.endAt.getTime())),
      ),
    };
    const occupancy = await this.repo.findOccupancy(educatorId, window, tx);
    const conflict = findEarliestConflict(ranges, occupancy, ignoreFixedTimeId);
    if (conflict) throw this.conflictError(conflict);
  }

  private conflictError(conflict: Conflict): CodedError {
    return new CodedError(
      'Este horário conflita com outro compromisso do seu educador.',
      409,
      'schedule_conflict',
      {
        studentName: conflict.studentName,
        startAt: conflict.startAt,
        endAt: conflict.endAt,
      },
    );
  }

  private async requireRule(
    clientId: string,
    fixedTimeId: string,
    tx: Tx,
  ): Promise<FixedTime> {
    const rule = await this.repo.findRuleOfClient(clientId, fixedTimeId, tx);
    if (!rule)
      throw new CodedError(FIXED_TIME_NOT_FOUND, 404, 'fixed_time_not_found');
    return rule;
  }

  private normalize(dto: CreateFixedTimeDTO): RuleValues {
    return {
      weekday: dto.weekday,
      startMinute: dto.startMinute,
      durationMinutes: dto.durationMinutes ?? FIXED_DURATION_DEFAULT_MINUTES,
      type: dto.type,
      onlineLink: dto.onlineLink ?? null,
      workoutLetter: dto.workoutLetter ?? null,
    };
  }

  /** Absent fields keep their stored value; a presencial type drops the link unless one is sent. */
  private merge(existing: FixedTime, dto: UpdateFixedTimeDTO): RuleValues {
    const type = dto.type ?? existing.type;
    let onlineLink =
      dto.onlineLink !== undefined ? dto.onlineLink : existing.onlineLink;
    if (type === SessionType.PRESENCIAL && dto.onlineLink === undefined) {
      onlineLink = null;
    }
    return {
      weekday: dto.weekday ?? existing.weekday,
      startMinute: dto.startMinute ?? existing.startMinute,
      durationMinutes: dto.durationMinutes ?? existing.durationMinutes,
      type,
      onlineLink,
      workoutLetter:
        dto.workoutLetter !== undefined
          ? dto.workoutLetter
          : existing.workoutLetter,
    };
  }

  private changedFields(
    before: RuleValues,
    after: RuleValues,
  ): Array<keyof RuleValues> {
    return (Object.keys(after) as Array<keyof RuleValues>).filter(
      (key) => before[key] !== after[key],
    );
  }

  private assertValid(rule: RuleValues): void {
    const problems = validateRule(rule);
    if (problems.length === 0) return;
    throw this.validationError(problems);
  }

  private validationError(problems: RuleProblem[]): CodedError {
    const linkOnly = problems.every(
      (problem) => problem.code === 'link_not_allowed',
    );
    return new CodedError(
      linkOnly
        ? 'Um horário presencial não aceita link.'
        : 'Verifique os dados do horário fixo.',
      400,
      linkOnly ? 'link_not_allowed' : 'fixed_time_invalid',
      problems.map((problem) => ({ field: problem.field, code: problem.code })),
    );
  }

  private ruleFields(rule: RuleValues): FixedTimeRuleFields {
    return {
      weekday: rule.weekday,
      startMinute: rule.startMinute,
      durationMinutes: rule.durationMinutes,
      type: rule.type,
      onlineLink: rule.onlineLink,
      workoutLetter: rule.workoutLetter,
    };
  }

  private ruleData(
    client: Client,
    educatorId: string,
    rule: RuleValues,
  ): FixedTimeData {
    return {
      clientId: client.id,
      professionalId: educatorId,
      ...this.ruleFields(rule),
    } as FixedTimeData;
  }

  private sessionRows(rule: FixedTime, ranges: TimeRange[]): SessionData[] {
    return ranges.map((range) => ({
      ...range,
      fixedTimeId: rule.id,
      clientId: rule.clientId,
      professionalId: rule.professionalId,
      type: rule.type,
      onlineLink: rule.onlineLink,
      workoutLetter: rule.workoutLetter,
    }));
  }

  private async activeSessionNames(clientId: string): Promise<string[] | null> {
    const active = await this.workouts.findActiveByClient(clientId);
    return active ? active.sessions.map((session) => session.name) : null;
  }

  private toFixedTimeDTO(
    rule: FixedTime,
    names: string[] | null,
  ): FixedTimeResponseDTO {
    const letter = resolveLetter(rule.workoutLetter, names);
    return {
      id: rule.id,
      weekday: rule.weekday,
      startMinute: rule.startMinute,
      durationMinutes: rule.durationMinutes,
      type: rule.type,
      onlineLink: rule.onlineLink,
      workoutLetter: rule.workoutLetter,
      workoutSessionName: letter.sessionName,
      workoutMissing: letter.missing,
    };
  }

  private fixedUpcoming(
    row: {
      id: string;
      startAt: Date;
      endAt: Date;
      type: SessionType;
      onlineLink: string | null;
      status: 'SCHEDULED' | 'CANCELED';
      workoutLetter: string | null;
    },
    names: string[] | null,
  ): UpcomingScheduleItemDTO {
    const letter = resolveLetter(row.workoutLetter, names);
    return {
      id: row.id,
      source: 'FIXED',
      startAt: row.startAt,
      endAt: row.endAt,
      type: row.type,
      onlineLink: row.onlineLink,
      status: row.status,
      workoutLetter: row.workoutLetter,
      workoutSessionName: letter.sessionName,
    };
  }

  private bookingUpcoming(row: Slot): UpcomingScheduleItemDTO {
    return {
      id: row.id,
      source: 'BOOKING',
      startAt: row.startAt,
      endAt: row.endAt,
      type: row.type ?? SessionType.PRESENCIAL,
      onlineLink: row.onlineLink,
      status: 'BOOKED',
      workoutLetter: null,
      workoutSessionName: null,
    };
  }
}
