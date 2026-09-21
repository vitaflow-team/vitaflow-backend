import { Test, TestingModule } from '@nestjs/testing';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { uploadServiceMock } from 'mock/upload.service.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { ProfileService } from './profile.service';

const BUCKET_AVATAR = 'https://storage.googleapis.com/test-bucket/1-avatar.png';
const GOOGLE_AVATAR = 'https://lh3.googleusercontent.com/a/abc=s96-c';

// Read through the fixtures rather than the container: these are plain jest
// mocks, which keeps assertions free of unbound class-method references.
const users = userRepositoryMock.useValue;
const upload = uploadServiceMock.useValue;
const clients = ClientsRepositoryMock.useValue;

describe('ProfileService Tests', () => {
  let profileService: ProfileService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        userRepositoryMock,
        uploadServiceMock,
        ClientsRepositoryMock,
        ProfileService,
      ],
    }).compile();

    profileService = moduleFixture.get<ProfileService>(ProfileService);

    jest.clearAllMocks();
    // clearAllMocks also drops the fixtures' own implementations, so the
    // defaults this suite relies on are restored per test.
    users.deleteAccount.mockResolvedValue(undefined);
    upload.deleteImage.mockResolvedValue(undefined);
    upload.isBucketUrl.mockImplementation(
      (url: unknown) =>
        typeof url === 'string' &&
        url.startsWith('https://storage.googleapis.com/test-bucket/'),
    );
    upload.getSignedUrl.mockResolvedValue('https://signed.example/avatar.png');
    clients.countByProfessionalId.mockResolvedValue(0);
  });

  const profileWith = (overrides: Record<string, unknown>) => ({
    ...userMock[0],
    productId: null,
    product: null,
    stripeCustomerId: null,
    userAddresses: null,
    ...overrides,
  });

  describe('deleteProfile', () => {
    // UT-007
    it('erases the account and then removes an app-hosted avatar', async () => {
      const order: string[] = [];
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({ avatar: BUCKET_AVATAR }),
      );
      users.deleteAccount.mockImplementationOnce(() => {
        order.push('deleteAccount');
        return Promise.resolve();
      });
      upload.deleteImage.mockImplementationOnce(() => {
        order.push('deleteImage');
        return Promise.resolve();
      });

      await expect(profileService.deleteProfile('1')).resolves.toBeUndefined();

      expect(users.deleteAccount).toHaveBeenCalledWith('1');
      expect(upload.deleteImage).toHaveBeenCalledWith(BUCKET_AVATAR);
      expect(order).toEqual(['deleteAccount', 'deleteImage']);
    });

    // UT-008
    it('skips storage entirely for a user with no avatar', async () => {
      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));

      await profileService.deleteProfile('1');

      expect(users.deleteAccount).toHaveBeenCalledWith('1');
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    // UT-009
    it('leaves an external Google avatar untouched', async () => {
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({ avatar: GOOGLE_AVATAR }),
      );

      await profileService.deleteProfile('1');

      expect(upload.isBucketUrl).toHaveBeenCalledWith(GOOGLE_AVATAR);
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    // UT-010
    it('rejects and deletes nothing when the user is gone', async () => {
      users.getUserProfile.mockResolvedValueOnce(null);

      await expect(profileService.deleteProfile('missing')).rejects.toThrow(
        'Usuário não encontrado.',
      );
      expect(users.deleteAccount).not.toHaveBeenCalled();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    // UT-011
    it('still succeeds when storage removal fails', async () => {
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({ avatar: BUCKET_AVATAR }),
      );
      upload.deleteImage.mockRejectedValueOnce(new Error('storage down'));

      await expect(profileService.deleteProfile('1')).resolves.toBeUndefined();

      expect(users.deleteAccount).toHaveBeenCalledWith('1');
    });

    // UT-012
    it('propagates a transaction failure without touching storage', async () => {
      const failure = new Error('transaction failed');
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({ avatar: BUCKET_AVATAR }),
      );
      users.deleteAccount.mockRejectedValueOnce(failure);

      await expect(profileService.deleteProfile('1')).rejects.toThrow(failure);
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    // UT-013
    it('reports the professional client count and 0 for a member', async () => {
      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));
      clients.countByProfessionalId.mockResolvedValueOnce(4);

      const professional = await profileService.getProfile('1');

      expect(professional.clientsCount).toBe(4);
      expect(clients.countByProfessionalId).toHaveBeenCalledWith('1');

      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));
      clients.countByProfessionalId.mockResolvedValueOnce(0);

      const member = await profileService.getProfile('1');

      expect(member.clientsCount).toBe(0);
    });

    // UT-010
    it('exposes the current product type and group, null without a product', async () => {
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({
          productId: 'prod-nutri',
          product: {
            id: 'prod-nutri',
            name: 'Profissional',
            price: 59.9,
            type: 'NUTRITIONIST',
            groupId: 'group-nutri',
            stripeId: 'price_123',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );

      const professional = await profileService.getProfile('1');

      expect(professional.productType).toBe('NUTRITIONIST');
      expect(professional.productGroupId).toBe('group-nutri');

      users.getUserProfile.mockResolvedValueOnce(profileWith({}));

      const planless = await profileService.getProfile('1');

      expect(planless.productType).toBeNull();
      expect(planless.productGroupId).toBeNull();
    });
  });
});
