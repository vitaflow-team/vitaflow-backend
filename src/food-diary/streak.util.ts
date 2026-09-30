function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function previousDay(date: Date): Date {
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous;
}

// Walks backward from today counting consecutive logged dates until the
// first gap — never a stored/denormalized field, so a backfilled entry
// inside an already-broken gap can never silently "repair" the streak
// (it only extends the count if it closes a gap immediately adjacent to
// the unbroken run ending today).
export function calculateStreak(
  loggedDates: Date[],
  today: Date = new Date(),
): number {
  const distinctDays = new Set(loggedDates.map(toDateKey));

  let streak = 0;
  let cursor = today;
  while (distinctDays.has(toDateKey(cursor))) {
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}
