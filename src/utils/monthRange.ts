// Calendar-month boundaries in UTC — same basis `dateRange.util.ts` (food
// diary) already uses for day boundaries, so "this month"/"last month"
// read consistently against `Users.createdAt`/`subscriptionCancelAt`
// wherever they're compared (platform-metrics-dashboard TechSpec).
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function startOfPreviousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}
