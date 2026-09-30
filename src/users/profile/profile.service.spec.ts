import { Test, TestingModule } from '@nestjs/testing';
import { AppError } from '@/utils/app.erro';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { avatarFile } from 'mock/imageFile.mock';
import { progressPhotosRepositoryMock } from 'mock/progressPhotos.repository.mock';
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
const progressPhotos = progressPhotosRepositoryMock.useValue;

describe('ProfileService Tests', () => {
  let profileService: ProfileService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        userRepositoryMock,
        uploadServiceMock,
        ClientsRepositoryMock,
        progressPhotosRepositoryMock,
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
    progressPhotos.findAllByUser.mockResolvedValue([]);
  });

  const profileWith = (overrides: Record<string, unknown>) => ({
    ...userMock[0],
    productId: null,
    product: null,
    stripeCustomerId: null,
    userAddresses: null,
    ...overrides,
  });

  describe('postProfile avatar replacement (platform-hardening US-003)', () => {
    const NEW_AVATAR = 'https://storage.googleapis.com/test-bucket/new.png';

    beforeEach(() => {
      upload.uploadImage.mockResolvedValue(NEW_AVATAR);
      users.updateUserProfile.mockImplementation(
        (_id: string, data: Record<string, unknown>) =>
          Promise.resolve({ ...profileWith({}), ...data, address: null }),
      );
    });

    const replaceAvatar = (
      currentAvatar: string | null,
      file = avatarFile(),
    ) => {
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({ avatar: currentAvatar }),
      );
      return profileService.postProfile(
        file,
        { name: 'Jonh Doe' } as never,
        '1',
      );
    };

    it('uploads the new avatar and removes the previous app-hosted one', async () => {
      const result = await replaceAvatar(BUCKET_AVATAR);

      expect(upload.uploadImage).toHaveBeenCalledTimes(1);
      expect(upload.isBucketUrl).toHaveBeenCalledWith(BUCKET_AVATAR);
      expect(upload.deleteImage).toHaveBeenCalledWith(BUCKET_AVATAR);
      expect(result.avatar).toBe(NEW_AVATAR);
    });

    it('never passes a Google avatar URL to the bucket delete (EC-1)', async () => {
      await replaceAvatar(GOOGLE_AVATAR);

      expect(upload.uploadImage).toHaveBeenCalledTimes(1);
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('deletes nothing when there was no previous avatar', async () => {
      await replaceAvatar(null);

      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('rejects a non-image before storage or the database is touched', async () => {
      const error: unknown = await replaceAvatar(
        BUCKET_AVATAR,
        avatarFile({ buffer: Buffer.from('%PDF-1.7 not an image') }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(400);
      expect(upload.uploadImage).not.toHaveBeenCalled();
      expect(upload.deleteImage).not.toHaveBeenCalled();
      expect(users.updateUserProfile).not.toHaveBeenCalled();
    });
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

    // UT-014 (progress-photos)
    it('deletes every ProgressPhoto storage object the account ever uploaded', async () => {
      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));
      progressPhotos.findAllByUser.mockResolvedValueOnce([
        { id: 'photo-1', storageFilename: 'photo-1.png' },
        { id: 'photo-2', storageFilename: 'photo-2.png' },
      ]);

      await profileService.deleteProfile('1');

      expect(progressPhotos.findAllByUser).toHaveBeenCalledWith('1');
      expect(upload.deleteImage).toHaveBeenCalledWith('photo-1.png');
      expect(upload.deleteImage).toHaveBeenCalledWith('photo-2.png');
      expect(upload.deleteImage).toHaveBeenCalledTimes(2);
    });

    it('a single failed progress-photo removal does not block the rest or fail the operation', async () => {
      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));
      progressPhotos.findAllByUser.mockResolvedValueOnce([
        { id: 'photo-1', storageFilename: 'photo-1.png' },
        { id: 'photo-2', storageFilename: 'photo-2.png' },
      ]);
      upload.deleteImage
        .mockRejectedValueOnce(new Error('storage down'))
        .mockResolvedValueOnce(undefined);

      await expect(profileService.deleteProfile('1')).resolves.toBeUndefined();

      expect(upload.deleteImage).toHaveBeenCalledWith('photo-1.png');
      expect(upload.deleteImage).toHaveBeenCalledWith('photo-2.png');
    });

    it('fetches the photo list before the account transaction runs', async () => {
      const order: string[] = [];
      users.getUserProfile.mockResolvedValueOnce(profileWith({ avatar: null }));
      progressPhotos.findAllByUser.mockImplementationOnce(() => {
        order.push('findAllByUser');
        return Promise.resolve([]);
      });
      users.deleteAccount.mockImplementationOnce(() => {
        order.push('deleteAccount');
        return Promise.resolve();
      });

      await profileService.deleteProfile('1');

      expect(order).toEqual(['findAllByUser', 'deleteAccount']);
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

    // UT-015 — plan expiry
    it('derives expiresAt and autoRenew for a renewing paid user', async () => {
      const periodEnd = new Date('2026-10-18T03:00:00.000Z');
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({
          productId: 'prod-premium',
          product: {
            id: 'prod-premium',
            name: 'Premium',
            price: 29.9,
            type: 'USER',
            groupId: 'group-1',
            stripeId: 'price_123',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          subscriptionStatus: 'active',
          subscriptionCancelAt: null,
          subscriptionCurrentPeriodEnd: periodEnd,
        }),
      );

      const profile = await profileService.getProfile('1');

      expect(profile.expiresAt).toEqual(periodEnd);
      expect(profile.autoRenew).toBe(true);
      // The raw fields stay for existing callers.
      expect(profile.subscriptionStatus).toBe('active');
      expect(profile.subscriptionCancelAt).toBeNull();
      expect(profile.subscriptionCurrentPeriodEnd).toEqual(periodEnd);
      expect(profile.productName).toBe('Premium');
    });

    // UT-015 — a scheduled cancellation expires on that date, not the period end
    it('reports the cancellation date and autoRenew false when cancelled', async () => {
      const cancelAt = new Date('2026-10-10T03:00:00.000Z');
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({
          productId: 'prod-premium',
          product: {
            id: 'prod-premium',
            name: 'Premium',
            price: 29.9,
            type: 'USER',
            groupId: 'group-1',
            stripeId: 'price_123',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          subscriptionStatus: 'active',
          subscriptionCancelAt: cancelAt,
          subscriptionCurrentPeriodEnd: new Date('2026-10-18T03:00:00.000Z'),
        }),
      );

      const profile = await profileService.getProfile('1');

      expect(profile.expiresAt).toEqual(cancelAt);
      expect(profile.autoRenew).toBe(false);
    });

    // UT-016 — Gratuito never reports an expiry, however stale its columns are
    it('returns no expiry for a Gratuito user with stale subscription dates', async () => {
      users.getUserProfile.mockResolvedValueOnce(
        profileWith({
          productId: 'free-1',
          product: {
            id: 'free-1',
            name: 'Gratuito',
            price: 0,
            type: 'USER',
            groupId: 'group-1',
            stripeId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          subscriptionStatus: 'active',
          subscriptionCancelAt: new Date('2026-10-10T03:00:00.000Z'),
          subscriptionCurrentPeriodEnd: new Date('2026-10-18T03:00:00.000Z'),
        }),
      );

      const profile = await profileService.getProfile('1');

      expect(profile.expiresAt).toBeNull();
      expect(profile.autoRenew).toBe(false);
    });
  });

  // UT-003 — the repository hands back the full row, password hash included
  describe('response never carries the password', () => {
    const address = {
      addressLine1: 'Rua A, 1',
      addressLine2: 'Apto 2',
      district: 'Centro',
      city: 'São Paulo',
      region: 'SP',
      postalCode: '01000-000',
    };
    const withSecrets = profileWith({
      password: '$2b$08$storedHash',
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
    });

    it('getProfile, with and without an address or avatar', async () => {
      users.getUserProfile.mockResolvedValueOnce(withSecrets);
      const bare = await profileService.getProfile('1');

      users.getUserProfile.mockResolvedValueOnce({
        ...withSecrets,
        avatar: BUCKET_AVATAR,
        userAddresses: { id: 'address-1', userId: '1', ...address },
      });
      const full = await profileService.getProfile('1');

      for (const profile of [bare, full]) {
        expect(Object.keys(profile)).not.toContain('password');
        expect(JSON.stringify(profile)).not.toContain('storedHash');
      }
      expect(bare.address).toBeNull();
      expect(full.address).toEqual(address);
    });

    it('postProfile, with and without an address', async () => {
      users.getUserProfile
        .mockResolvedValueOnce(withSecrets)
        .mockResolvedValueOnce(withSecrets);
      users.updateUserProfile.mockResolvedValueOnce({
        ...withSecrets,
        address: null,
      });
      const bare = await profileService.postProfile(
        undefined as unknown as Express.Multer.File,
        { name: 'Jonh Doe' } as never,
        '1',
      );

      users.updateUserProfile.mockResolvedValueOnce({
        ...withSecrets,
        address,
      });
      const full = await profileService.postProfile(
        undefined as unknown as Express.Multer.File,
        { name: 'Jonh Doe', ...address } as never,
        '1',
      );

      for (const profile of [bare, full]) {
        expect(Object.keys(profile)).not.toContain('password');
        expect(Object.keys(profile)).not.toContain('stripeCustomerId');
        expect(Object.keys(profile)).not.toContain('stripeSubscriptionId');
        expect(profile).toMatchObject({
          id: '1',
          name: userMock[0].name,
          email: userMock[0].email,
        });
      }
      expect(bare.address).toBeNull();
      expect(full.address).toEqual(address);
    });
  });

  // standards-enforcement UT-001
  describe('nonexistent user', () => {
    it('getProfile rejects with AppError 404', async () => {
      users.getUserProfile.mockResolvedValueOnce(null);

      const attempt = profileService.getProfile('missing');

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 404,
        message: 'Usuário não encontrado.',
      });
    });

    it('postProfile rejects with AppError 404 and uploads nothing', async () => {
      users.getUserProfile.mockResolvedValueOnce(null);

      const attempt = profileService.postProfile(
        avatarFile(),
        {} as never,
        'missing',
      );

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 404,
        message: 'Usuário não encontrado.',
      });
      expect(upload.uploadImage).not.toHaveBeenCalled();
    });
  });
});
