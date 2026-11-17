// How many users are delinquent, and in which aging band their oldest overdue
// payment puts them (the bands add up to `total`).
export interface PlatformDelinquentCounts {
  total: number;
  d1to7: number;
  d8to30: number;
  d31Plus: number;
}
