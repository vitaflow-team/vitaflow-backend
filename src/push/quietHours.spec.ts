import { formatClockTime, parseClockTime } from './clockTime';
import { DEFAULT_QUIET_HOURS, isInQuietHours } from './quietHours';

// BRT is UTC-3, so 12:00 BRT is 15:00Z.
const at = (hourBrt: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, 18, hourBrt + 3, minute));

describe('quiet hours', () => {
  it('UT-010 uses 22:00-07:00 by default', () => {
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, at(23, 30))).toBe(true);
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, at(3))).toBe(true);
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, at(12))).toBe(false);
  });

  it('UT-011 includes the start and excludes the end', () => {
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, at(22, 0))).toBe(true);
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, at(7, 0))).toBe(false);
  });

  it('UT-012 treats equal start and end as disabled', () => {
    const window = { enabled: true, startMinute: 480, endMinute: 480 };
    expect(isInQuietHours(window, at(8))).toBe(false);
  });

  it('UT-013 covers almost the whole day for a 00:00-23:45 window', () => {
    const window = { enabled: true, startMinute: 0, endMinute: 1425 };
    expect(isInQuietHours(window, at(12))).toBe(true);
    expect(isInQuietHours(window, at(23, 50))).toBe(false);
  });

  it('UT-014 is never quiet when disabled', () => {
    expect(
      isInQuietHours({ ...DEFAULT_QUIET_HOURS, enabled: false }, at(23)),
    ).toBe(false);
  });

  it('UT-015 evaluates in Brasília time', () => {
    const instant = new Date('2026-11-18T01:30:00Z');
    expect(isInQuietHours(DEFAULT_QUIET_HOURS, instant)).toBe(true);
  });

  it('UT-016 parses and formats clock times', () => {
    expect(parseClockTime('07:00')).toBe(420);
    expect(formatClockTime(420)).toBe('07:00');
    for (const invalid of ['25:00', '7:5', '24:00', 'abc', '']) {
      expect(parseClockTime(invalid)).toBeNull();
    }
  });
});
