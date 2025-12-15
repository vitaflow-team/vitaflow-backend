import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { uploadServiceMock } from 'mock/upload.service.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { ProfileDTO } from './profile.Dto';
import { ProfileController } from './profile.controller';

describe('ProfileController Tests', () => {
  let profileController: ProfileController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [userRepositoryMock, jwtServiceMock, uploadServiceMock],
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

  it('Get user profile - user not exists', async () => {
    await expect(
      profileController.getProfile({
        user: {
          id: 'idUserNotExists',
        },
      }),
    ).rejects.toHaveProperty('statusCode', 402);
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
});
