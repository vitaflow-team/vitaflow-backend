const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" to minutes since midnight, or null when malformed. */
export function parseClockTime(value: string): number | null {
  const match = CLOCK_TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight to "HH:mm". */
export function formatClockTime(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
