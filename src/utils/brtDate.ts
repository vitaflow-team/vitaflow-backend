export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function brtDateKey(instant: Date): string {
  const shifted = new Date(instant.getTime() - BRT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** 0 (Sunday) through 6 (Saturday), in BRT. */
export function brtWeekday(instant: Date): number {
  const shifted = new Date(instant.getTime() - BRT_OFFSET_MS);
  return shifted.getUTCDay();
}

/** 0 through 23, in BRT. */
export function brtHour(instant: Date): number {
  const shifted = new Date(instant.getTime() - BRT_OFFSET_MS);
  return shifted.getUTCHours();
}
