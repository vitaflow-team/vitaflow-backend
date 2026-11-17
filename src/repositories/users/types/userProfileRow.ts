import { OAuthIdentity, Product, UserAddress, Users } from '@prisma/client';

// The account as GET /profile needs it: the row plus its address, its plan
// and, when it has one, its linked Google identity.
export type UserProfileRow = Users & {
  userAddresses: UserAddress | null;
  product: Product | null;
  oAuthIdentity: OAuthIdentity | null;
};
