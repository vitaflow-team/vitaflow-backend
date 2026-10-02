import { AvailabilityWindow } from '@prisma/client';
import { generateSlotsForWindow } from './slotGeneration.util';

function window(
  overrides: Partial<AvailabilityWindow> = {},
): AvailabilityWindow {
  return {
    id: 'window-1',
    professionalId: 'professional-1',
    dayOfWeek: 1,
    startMinute: 540,
    endMinute: 720,
    sessionDurationMinutes: 45,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('generateSlotsForWindow', () => {
  // US-001.AC-1, AC-2 — now is Thursday 2026-10-01 12:00 UTC (09:00 BRT),
  // well before any matching Monday, so every generated slot is future.
  const now = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));

  it('generates non-overlapping slots spaced by the session duration, across the rolling 4-week window', () => {
    const slots = generateSlotsForWindow(window(), now);

    // 4 Mondays (Oct 5, 12, 19, 26) x 4 slots each (09:00-12:00 BRT / 45min)
    expect(slots).toHaveLength(16);
    expect(slots[0].startAt).toEqual(new Date(Date.UTC(2026, 9, 5, 12, 0, 0)));
    expect(slots[0].endAt).toEqual(new Date(Date.UTC(2026, 9, 5, 12, 45, 0)));
    expect(slots[1].startAt).toEqual(new Date(Date.UTC(2026, 9, 5, 12, 45, 0)));
    expect(
      slots.every((slot) => slot.professionalId === 'professional-1'),
    ).toBe(true);
    expect(
      slots.every((slot) => slot.availabilityWindowId === 'window-1'),
    ).toBe(true);
  });

  it('stops once the next slot would overrun the window end, when the duration does not evenly divide it', () => {
    const slots = generateSlotsForWindow(
      window({ sessionDurationMinutes: 50 }),
      now,
    );
    const firstMondaySlots = slots.filter(
      (slot) =>
        slot.startAt >= new Date(Date.UTC(2026, 9, 5, 0, 0, 0)) &&
        slot.startAt < new Date(Date.UTC(2026, 9, 6, 0, 0, 0)),
    );

    // 180min window / 50min duration = 3 full slots, not 4 — the 4th would
    // end at 12:20, past the 12:00 BRT window end.
    expect(firstMondaySlots).toHaveLength(3);
  });

  it('skips already-past slots on the current day but still generates later ones the same day', () => {
    // 2026-10-05 is the first matching Monday from `now` above.
    // 10:00 BRT = 13:00 UTC: 09:00 and 09:45 BRT have passed, 10:30 and
    // 11:15 have not.
    const sameDayNow = new Date(Date.UTC(2026, 9, 5, 13, 0, 0));
    const slots = generateSlotsForWindow(window(), sameDayNow);

    const oct5Slots = slots.filter(
      (slot) => slot.startAt < new Date(Date.UTC(2026, 9, 6, 0, 0, 0)),
    );
    expect(oct5Slots).toHaveLength(2);
    expect(oct5Slots[0].startAt).toEqual(
      new Date(Date.UTC(2026, 9, 5, 13, 30, 0)),
    );
    expect(oct5Slots[1].startAt).toEqual(
      new Date(Date.UTC(2026, 9, 5, 14, 15, 0)),
    );
  });

  it('maps ISO day 7 (Sunday) correctly against JS Date.getUTCDay()=0', () => {
    // 2026-10-04 is a Sunday.
    const slots = generateSlotsForWindow(window({ dayOfWeek: 7 }), now);

    expect(slots[0].startAt).toEqual(new Date(Date.UTC(2026, 9, 4, 12, 0, 0)));
  });

  it('generates zero slots when the duration is longer than the window span', () => {
    const slots = generateSlotsForWindow(
      window({ startMinute: 540, endMinute: 570, sessionDurationMinutes: 45 }),
      now,
    );

    expect(slots).toEqual([]);
  });
});
