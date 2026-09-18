import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';

export const oauthIdentityRepositoryMock = {
  provide: OAuthIdentityRepository,
  useValue: {
    findByProviderAccount: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
  },
};
