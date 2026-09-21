import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { uploadServiceMock } from 'mock/upload.service.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { ProfileDTO } from './profile.Dto';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

describe('ProfileController Tests', () => {
  let profileController: ProfileController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        userRepositoryMock,
        jwtServiceMock,
        uploadServiceMock,
        ClientsRepositoryMock,
        ProfileService,
      ],
    }).compile();

    profileController = moduleFixture.get<ProfileController>(ProfileController);
  });

  it('Should be defined', () => {
    expect(profileController).toBeDefined();
  });

  it('Update user profile - no birthDate', async () => {
    const body = {
      name: 'Jonh Doe Profile',
      phone: '99999999999',
      avatar: '',
      birthDate: undefined,
      addressLine1: 'Jonh Doe address line 1',
      addressLine2: 'Jonh Doe address line 2',
      district: 'Jonh Doe',
      city: 'JonhDoe City',
      region: 'SP',
      postalCode: '12345-678',
    };
    const req = {
      user: {
        id: '1',
      },
    };

    const result = await profileController.postProfile(
      null as any,
      body as any,
      req,
    );

    expect(result.id).toEqual(req.user.id);
    expect(result.phone).toEqual(body.phone);
    expect(result.birthDate).toBeNull();
    expect(result.address?.district).toEqual(body.district);
  });

  it('Update user profile - with address', async () => {
    const body = {
      name: 'Jonh Doe Profile',
      phone: '99999999999',
      birthDate: new Date('2010-10-10'),
      avatar: '',
      addressLine1: 'Jonh Doe address line 1',
      addressLine2: 'Jonh Doe address line 2',
      district: 'Jonh Doe',
      city: 'JonhDoe City',
      region: 'SP',
      postalCode: '12345-678',
    };
    const req = {
      user: {
        id: '1',
      },
    };

    const result = await profileController.postProfile(
      null as any,
      body as any,
      req,
    );

    expect(result.id).toEqual(req.user.id);
    expect(result.phone).toEqual(body.phone);
    expect(result.birthDate).toEqual(body.birthDate);
    expect(result.address?.district).toEqual(body.district);
  });

  it('Update user profile - user not exists', async () => {
    const body = {
      name: 'Jonh Doe Profile',
      addressLine1: 'Address 1',
      district: 'District',
      city: 'City',
      region: 'SP',
      postalCode: '12345678',
    } as any;

    const req = {
      user: {
        id: 'idUserNotExists',
      },
    };

    await expect(
      profileController.postProfile(null as any, body, req),
    ).rejects.toThrow('Usuário não encontrado.');
  });

  it('Update user profile - replace avatar', async () => {
    const body = {
      name: 'Jonh Doe Profile',
      phone: '99999999999',
      birthDate: new Date('2010-10-10'),
      avatar: '',
      addressLine1: 'Jonh Doe address line 1',
      addressLine2: 'Jonh Doe address line 2',
      district: 'Jonh Doe',
      city: 'JonhDoe City',
      region: 'SP',
      postalCode: '12345-678',
    };
    const req = {
      user: {
        id: '1',
      },
    };

    // Mocking getUserProfile for this specific test to return a user with an existing avatar
    const userWithAvatar = { ...userMock[0], avatar: 'old-avatar.jpg' };
    jest
      .spyOn(userRepositoryMock.useValue, 'getUserProfile')
      .mockResolvedValueOnce(userWithAvatar as any);

    const mockAvatarFile = {
      fieldname: 'avatar',
      originalname: 'new-avatar.jpg',
    } as any;

    await profileController.postProfile(mockAvatarFile, body, req);

    expect(uploadServiceMock.useValue.uploadImage).toHaveBeenCalled();
    expect(uploadServiceMock.useValue.deleteImage).toHaveBeenCalledWith(
      'old-avatar.jpg',
    );
  });

  it('Get user profile - user not exists', async () => {
    await expect(
      profileController.getProfile({
        user: {
          id: 'idUserNotExists',
        },
      }),
    ).rejects.toThrow('Usuário não encontrado.');
  });

  it('Get user profile - successfully', async () => {
    const profile = await profileController.getProfile({
      user: {
        id: userMock[0].id,
      },
    });

    expect(profile.id).toEqual(userMock[0].id);
    expect(profile.email).toEqual(userMock[0].email);
  });

  describe('Get user profile - plan fields', () => {
    // UT-051
    it('returns productName and subscriptionCurrentPeriodEnd, and no Stripe identifiers', async () => {
      const periodEnd = new Date('2026-10-18T15:00:00.000Z');
      jest
        .spyOn(userRepositoryMock.useValue, 'getUserProfile')
        .mockResolvedValueOnce({
          ...userMock[0],
          productId: 'product-1',
          product: { id: 'product-1', name: 'Plano Premium' },
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'active',
          subscriptionCancelAt: null,
          subscriptionCurrentPeriodEnd: periodEnd,
          userAddresses: null,
        } as any);

      const profile = await profileController.getProfile({
        user: { id: userMock[0].id },
      });

      expect(profile.productName).toEqual('Plano Premium');
      expect(profile.subscriptionCurrentPeriodEnd).toEqual(periodEnd);
      expect(profile.subscriptionStatus).toEqual('active');
      expect(profile.hasStripeCustomer).toBe(true);
      expect(profile).not.toHaveProperty('stripeCustomerId');
      expect(profile).not.toHaveProperty('stripeSubscriptionId');
      expect(JSON.stringify(profile)).not.toContain('cus_123');
      expect(JSON.stringify(profile)).not.toContain('sub_123');
    });

    // UT-052
    it('returns nulls for a user with no product', async () => {
      jest
        .spyOn(userRepositoryMock.useValue, 'getUserProfile')
        .mockResolvedValueOnce({
          ...userMock[0],
          productId: null,
          product: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: null,
          subscriptionCancelAt: null,
          subscriptionCurrentPeriodEnd: null,
          userAddresses: null,
        } as any);

      const profile = await profileController.getProfile({
        user: { id: userMock[0].id },
      });

      expect(profile.productName).toBeNull();
      expect(profile.subscriptionCurrentPeriodEnd).toBeNull();
      expect(profile.hasStripeCustomer).toBe(false);
      expect(profile).not.toHaveProperty('stripeCustomerId');
    });
  });

  it('Update user profile - string conversion to DTO', () => {
    const plainData = {
      name: 'Jonh Doe Profile',
      phone: '99999999999',
      birthDate: '2010-10-10T00:00:00.000Z',
      avatar: '',
      addressLine1: 'Jonh Doe address line 1',
      addressLine2: 'Jonh Doe address line 2',
      district: 'Jonh Doe',
      city: 'JonhDoe City',
      region: 'SP',
      postalCode: '12345-678',
    };

    const body = plainToInstance(ProfileDTO, plainData);

    expect(body.birthDate).toBeInstanceOf(Date);
    expect(body.district).toBeDefined();
  });

  // UT-014
  describe('Delete user profile', () => {
    it('acts only on the authenticated user, ignoring ids in the request', async () => {
      const deleteAccount = jest.spyOn(
        userRepositoryMock.useValue,
        'deleteAccount',
      );
      deleteAccount.mockClear();

      // Bound to a const so the extra keys survive: the point of the case
      // is that an id smuggled in via params or body changes nothing.
      const req = {
        user: { id: '1' },
        params: { id: '2' },
        body: { id: '2' },
      };

      const result = await profileController.deleteProfile(req);

      expect(result).toBeUndefined();
      expect(deleteAccount).toHaveBeenCalledTimes(1);
      expect(deleteAccount).toHaveBeenCalledWith('1');
      expect(deleteAccount).not.toHaveBeenCalledWith('2');
    });
  });
});
