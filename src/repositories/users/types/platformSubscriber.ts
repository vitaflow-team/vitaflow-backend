import type { ProductType } from '@prisma/client';

// A user matched to a gateway customer, with the plan they hold right now.
export interface PlatformSubscriber {
  id: string;
  asaasCustomerId: string;
  product: { type: ProductType; name: string } | null;
}
