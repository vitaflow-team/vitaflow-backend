const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function brtDateKey(instant: Date): string {
  const shifted = new Date(instant.getTime() - BRT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}
