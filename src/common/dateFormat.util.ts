// `YYYY-MM-DD` of a stored calendar date (a `@db.Date` comes back as UTC
// midnight, so the UTC slice is the date that was saved).
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
