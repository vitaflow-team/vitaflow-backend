import type { BackofficeTier } from '@prisma/client';

export interface BackofficeStaff {
  id: string;
  backofficeTier: BackofficeTier | null;
}
