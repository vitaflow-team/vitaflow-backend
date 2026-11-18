// The result of a sync or backfill run. A failed run keeps every row written
// before the failure and says where it stopped.
export interface SyncSummary {
  ok: boolean;
  pages: number;
  fetched: number;
  upserted: number;
  canceled: number;
  skipped: number;
  failedAtOffset: number | null;
}
