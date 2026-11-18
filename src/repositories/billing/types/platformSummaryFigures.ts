import type { ProductType } from '@prisma/client';
import type { PlatformFigures } from './platformFigures';

export interface PlatformSummaryFigures {
  total: PlatformFigures;
  byAccountType: Record<ProductType, PlatformFigures>;
}
