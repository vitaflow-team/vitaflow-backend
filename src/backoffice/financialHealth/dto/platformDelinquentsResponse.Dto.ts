import type { BackofficeTier } from '@prisma/client';
import type { PlatformBandCountsDTO } from './platformBandCounts.Dto';
import type { PlatformDelinquentRowDTO } from './platformDelinquentRow.Dto';

// The same payload for both tiers: `tier` tells the page what the caller may
// also open, and no revenue total is ever part of it.
export interface PlatformDelinquentsResponseDTO {
  tier: BackofficeTier;
  bandCounts: PlatformBandCountsDTO;
  items: PlatformDelinquentRowDTO[];
  page: number;
  pageSize: 20;
  total: number;
}
