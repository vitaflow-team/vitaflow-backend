import type { BackofficeAccessResource, BackofficeTier } from '@prisma/client';

export interface NewBackofficeAccessLog {
  staffUserId: string;
  tier: BackofficeTier;
  resource: BackofficeAccessResource;
  page: number;
}
