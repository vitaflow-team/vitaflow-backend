import type { ProductType } from '@prisma/client';
import type { MonthTotalsDTO } from '@/financial-health/dto/monthTotals.Dto';

// The month figures per account type: student (USER), nutritionist, educator
// (PHYSICAL_EDUCATOR) and gym (ACADEMIA). Every type is always present.
export type PlatformAccountTotalsDTO = Record<ProductType, MonthTotalsDTO>;
