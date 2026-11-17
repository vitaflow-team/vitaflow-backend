// Delinquent users per aging band, by the band of their oldest overdue
// payment (the three add up to the list total).
export interface PlatformBandCountsDTO {
  d1to7: number;
  d8to30: number;
  d31Plus: number;
}
