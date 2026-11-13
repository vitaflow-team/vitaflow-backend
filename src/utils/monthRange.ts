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

// Ascending, oldest first — e.g. for date=2026-03-15, n=3 returns the UTC
// month starts for 2026-01-01, 2026-02-01, 2026-03-01 (cohort-ltv-analysis).
export function lastNMonthStarts(date: Date, n: number): Date[] {
  const currentMonthStart = startOfMonth(date);
  const starts: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    starts.push(
      new Date(
        Date.UTC(
          currentMonthStart.getUTCFullYear(),
          currentMonthStart.getUTCMonth() - i,
          1,
        ),
      ),
    );
  }
  return starts;
}
