// What one batch of gateway payments did to the local table.
export interface IngestOutcome {
  upserted: number;
  canceled: number;
  skipped: number;
}
