import type {
  Client,
  GymRecurringBilling,
  Product,
  Users,
} from '@prisma/client';

// An active recurring billing with what the nightly issuer needs to act on
// it: the student and the gym owner who bills.
export interface IssuableBilling {
  billing: GymRecurringBilling;
  client: Client;
  owner: (Users & { product: Product | null }) | null;
}
