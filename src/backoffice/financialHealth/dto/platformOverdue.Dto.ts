import type { ProductType } from '@prisma/client';
import type { OverdueSummaryDTO } from '@/financial-health/dto/overdueSummary.Dto';

// Today's overdue situation (always current, whatever month is selected), in
// total and per account type.
export interface PlatformOverdueDTO extends OverdueSummaryDTO {
  byAccountType: Record<ProductType, OverdueSummaryDTO>;
}
