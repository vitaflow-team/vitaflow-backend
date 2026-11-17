export interface UpcomingFeesInput {
  ownerId: string;
  clientId: string;
  // `YYYY-MM-DD` Brasília date: fees due on or after it are canceled.
  todayKey: string;
}
