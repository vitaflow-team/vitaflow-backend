const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Parses a `YYYY-MM-DD` request param into a UTC midnight Date — the same
// representation Prisma's `@db.Date` column expects and `Meal.loggedAt`
// range queries scope against.
export function parseDateParam(date: string): Date {
  if (!DATE_ONLY.test(date)) {
    throw new Error(`Invalid date: ${date}`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

export function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function startOfNextDay(date: Date): Date {
  const next = startOfDay(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function subtractDays(date: Date, days: number): Date {
  const result = startOfDay(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
