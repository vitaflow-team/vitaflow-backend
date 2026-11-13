import { lastNMonthStarts } from './monthRange';

describe('lastNMonthStarts', () => {
  // UT-001
  it('returns 12 ascending UTC month starts ending at the current month', () => {
    const now = new Date('2026-03-15T00:00:00Z');

    const starts = lastNMonthStarts(now, 12);

    expect(starts).toHaveLength(12);
    expect(starts[0]).toEqual(new Date('2025-04-01T00:00:00Z'));
    expect(starts[11]).toEqual(new Date('2026-03-01T00:00:00Z'));
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i].getUTCMonth()).not.toBe(starts[i - 1].getUTCMonth());
    }
  });

  // UT-002
  it('returns exactly one entry, the current month start, when n is 1', () => {
    const now = new Date('2026-03-15T00:00:00Z');

    const starts = lastNMonthStarts(now, 1);

    expect(starts).toEqual([new Date('2026-03-01T00:00:00Z')]);
  });

  // UT-003
  it('returns an empty array when n is 0', () => {
    const now = new Date('2026-03-15T00:00:00Z');

    expect(lastNMonthStarts(now, 0)).toEqual([]);
  });
});
