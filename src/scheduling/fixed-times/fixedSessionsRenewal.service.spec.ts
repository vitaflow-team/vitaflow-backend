import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { SessionType } from '@prisma/client';
import { Clock } from '../clock.service';
import { FixedSessionsRenewalService } from './fixedSessionsRenewal.service';

const NOW = new Date('2026-10-07T10:00:00Z');

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: 'fixed-1',
  clientId: 'client-1',
  professionalId: 'educator-1',
  weekday: 1,
  startMinute: 7 * 60,
  durationMinutes: 60,
  type: SessionType.PRESENCIAL,
  onlineLink: null,
  workoutLetter: null,
  ...overrides,
});

describe('FixedSessionsRenewalService (UT-072 to UT-076)', () => {
  let repo: Record<string, jest.Mock>;
  let clock: { now: () => Date };
  let service: FixedSessionsRenewalService;

  beforeEach(() => {
    repo = {
      findAllRules: jest.fn().mockResolvedValue([rule()]),
      withEducatorLock: jest.fn(
        (_educator: string, work: (tx: unknown) => unknown) => work({}),
      ),
      findRuleSessionsBetween: jest.fn().mockResolvedValue([]),
      findOccupancy: jest.fn().mockResolvedValue([]),
      createSessionsSkippingDuplicates: jest.fn((rows: unknown[]) =>
        Promise.resolve(rows.length),
      ),
    };
    clock = { now: () => NOW };
    service = new FixedSessionsRenewalService(
      repo as unknown as FixedTimesRepository,
      clock as Clock,
    );
  });

  it('UT-072 creates the missing sessions of every rule up to 35 days ahead', async () => {
    const summary = await service.runRenewal();

    expect(summary).toMatchObject({ fixedTimes: 1, created: 5, conflicts: 0 });
    const rows = repo.createSessionsSkippingDuplicates.mock
      .calls[0][0] as Array<{ startAt: Date }>;
    expect(rows[0].startAt.toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });

  it('UT-072 running twice creates nothing the second time (existing rows are covered)', async () => {
    const first = await service.runRenewal();
    const created = repo.createSessionsSkippingDuplicates.mock
      .calls[0][0] as Array<{ startAt: Date }>;
    repo.findRuleSessionsBetween.mockResolvedValue(
      created.map((row) => ({ ...row, status: 'SCHEDULED' })),
    );

    const second = await service.runRenewal();

    expect(first.created).toBe(5);
    expect(second.created).toBe(0);
  });

  it('UT-073 skips Brasília dates that have a canceled session or any session', async () => {
    repo.findRuleSessionsBetween.mockResolvedValue([
      { startAt: new Date('2026-10-12T10:00:00Z'), status: 'CANCELED' },
      { startAt: new Date('2026-10-19T10:00:00Z'), status: 'SCHEDULED' },
    ]);

    const summary = await service.runRenewal();

    expect(summary.created).toBe(3);
    const rows = repo.createSessionsSkippingDuplicates.mock
      .calls[0][0] as Array<{ startAt: Date }>;
    expect(rows.map((row) => row.startAt.toISOString())).not.toContain(
      '2026-10-12T10:00:00.000Z',
    );
    expect(rows.map((row) => row.startAt.toISOString())).not.toContain(
      '2026-10-19T10:00:00.000Z',
    );
  });

  it('UT-074 skips a date that now overlaps a booking, logs it and continues', async () => {
    repo.findOccupancy.mockResolvedValue([
      {
        startAt: new Date('2026-10-12T10:30:00Z'),
        endAt: new Date('2026-10-12T11:30:00Z'),
        status: 'BOOKED',
        fixedTimeId: null,
        studentName: 'Ana',
      },
    ]);

    const summary = await service.runRenewal();

    expect(summary.conflicts).toBe(1);
    expect(summary.created).toBe(4);
  });

  it('UT-075 logs the run summary', async () => {
    const log = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => {});

    await service.runRenewal();

    expect(log).toHaveBeenCalledWith(
      'fixed_renewal_run fixedTimes=1 created=5 skipped=0 conflicts=0',
    );
  });

  it('UT-076 reads time only from the Clock: a week later the window moves by a week', async () => {
    await service.runRenewal();
    const first = (
      repo.createSessionsSkippingDuplicates.mock.calls[0][0] as Array<{
        startAt: Date;
      }>
    ).at(-1)!;

    clock.now = () => new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    repo.createSessionsSkippingDuplicates.mockClear();
    await service.runRenewal();
    const rows = repo.createSessionsSkippingDuplicates.mock
      .calls[0][0] as Array<{ startAt: Date }>;

    expect(rows.at(-1)!.startAt.getTime()).toBeGreaterThan(
      first.startAt.getTime(),
    );
  });
});
