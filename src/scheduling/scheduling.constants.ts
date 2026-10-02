// Brazil has had no DST since 2019 and this product serves only the
// Brazilian market (TechSpec Key Decisions) — a fixed offset is sufficient,
// no timezone library is needed.
export const BRT_OFFSET_MINUTES = 180;

// How far ahead slot generation expands a window into concrete Slot rows.
export const ROLLING_WEEKS = 4;

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export const REMINDER_WINDOW_START_MINUTES = 55;
export const REMINDER_WINDOW_END_MINUTES = 65;
