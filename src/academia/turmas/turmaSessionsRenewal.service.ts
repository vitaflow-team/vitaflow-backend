import { Clock } from '@/scheduling/clock.service';
import { FIXED_MATERIALIZE_DAYS } from '@/scheduling/fixed-times/fixedTime.constants';
import {
  brtDateKey,
  occurrencesBetween,
} from '@/scheduling/fixed-times/fixedTime.util';
import {
  Tx,
  TurmaSessionData,
  TurmasRepository,
} from '@/repositories/academia/turmas.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Turma } from '@prisma/client';

export interface TurmaRenewalSummary {
  turmas: number;
  created: number;
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TurmaSessionsRenewalService {
  private readonly logger = new Logger(TurmaSessionsRenewalService.name);

  constructor(
    private readonly repo: TurmasRepository,
    private readonly clock: Clock,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async runRenewal(): Promise<TurmaRenewalSummary> {
    const now = this.clock.now();
    const until = new Date(now.getTime() + FIXED_MATERIALIZE_DAYS * DAY_MS);
    const turmas = await this.repo.findAllLiveRules();

    const summary: TurmaRenewalSummary = {
      turmas: turmas.length,
      created: 0,
      skipped: 0,
    };
    for (const turma of turmas) {
      const part = await this.materializeForTurma(turma, now, until);
      summary.created += part.created;
      summary.skipped += part.skipped;
    }

    this.logger.log(
      `turma_renewal_run turmas=${summary.turmas} created=${summary.created} skipped=${summary.skipped}`,
    );
    return summary;
  }

  async materializeForTurma(
    turma: Turma,
    now: Date = this.clock.now(),
    until: Date = new Date(now.getTime() + FIXED_MATERIALIZE_DAYS * DAY_MS),
    tx?: Tx,
  ): Promise<{ created: number; skipped: number }> {
    const existing = await this.repo.findRuleSessionsBetween(
      turma.id,
      { startAt: now, endAt: until },
      tx,
    );
    const covered = new Set(existing.map((row) => brtDateKey(row.startAt)));
    const candidates = occurrencesBetween(turma, now, until, covered);

    const rows: TurmaSessionData[] = candidates.map((range) => ({
      ...range,
      turmaId: turma.id,
    }));
    const created = await this.repo.createSessionsSkippingDuplicates(rows, tx);
    return { created, skipped: covered.size };
  }
}
