import type { PlatformPaymentStatus, ProductType } from '@prisma/client';

// One row of the local platform payment table as it is written. Dates are
// calendar dates (YYYY-MM-DD) so no timezone can shift them.
export interface PlatformPaymentData {
  asaasPaymentId: string;
  userId: string;
  asaasCustomerId: string;
  asaasSubscriptionId: string | null;
  productType: ProductType;
  productName: string;
  valueCents: number;
  status: PlatformPaymentStatus;
  dueDate: string;
  paidAt: string | null;
  paidAmountCents: number | null;
}
