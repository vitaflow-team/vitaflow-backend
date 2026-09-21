import { AuthGuard } from '@/auth/auth.guard';
import { ApiKeyGuard } from '@/common/guards/api-key.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { UploadService } from '@/utils/upload.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

// Google Cloud Storage is the only outbound dependency of this slice; the
// database is deliberately the real one. The factory stays self-contained so
// nothing leaks out to real credentials or network calls.
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: jest.fn((name: string) => ({
      name,
      file: jest.fn(() => ({
        exists: jest.fn().mockResolvedValue([false]),
        delete: jest.fn().mockResolvedValue(undefined),
        getSignedUrl: jest
          .fn()
          .mockResolvedValue(['https://signed.test/avatar.png']),
      })),
    })),
  })),
}));

jest.setTimeout(30_000);

const BUCKET = 'test-bucket';
const BUCKET_AVATAR = `https://storage.googleapis.com/${BUCKET}/1-avatar.png`;
const GOOGLE_AVATAR = 'https://lh3.googleusercontent.com/a/abc=s96-c';

describe('Account deletion integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let uploadService: UploadService;
  let deleteImage: jest.SpyInstance<Promise<void>, [fileUrl: string]>;
  const jwtSecret = 'profile-delete-integration-jwt-secret';
  const applicationSecret = 'profile-delete-integration-application-secret';
  const createdUserIds = new Set<string>();
  let sequence = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.GCP_CLIENT_EMAIL = 'test@integration.test';
    process.env.GCP_PRIVATE_KEY = 'test-private-key';
    process.env.GCP_BUCKET = BUCKET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ProfileController, SubscriptionController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        ProductsRepository,
        UploadService,
        ProfileService,
        SubscriptionService,
        AuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLICATION_SECRET' ? applicationSecret : undefined,
          },
        },
        // The real app registers this globally, and the webhook sync route
        // relies on it instead of a user JWT — so it has to be here for
        // IT-009 to exercise the same gate production does.
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    uploadService = moduleFixture.get(UploadService);
  });

  beforeEach(() => {
    sequence += 1;
    deleteImage = jest
      .spyOn(uploadService, 'deleteImage')
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      await prisma.client.deleteMany({
        where: {
          OR: [{ professionalId: { in: ids } }, { userId: { in: ids } }],
        },
      });
      await prisma.measurementRecord.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.usersToken.deleteMany({ where: { userID: { in: ids } } });
      await prisma.userAddress.deleteMany({ where: { userId: { in: ids } } });
      await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
      await prisma.users.deleteMany({ where: { id: { in: ids } } });
      createdUserIds.clear();
    }
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(
    label: string,
    overrides: { avatar?: string | null } = {},
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Deletion ${label}`,
        email: `deletion-${label}-${sequence}-${Date.now()}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        avatar: overrides.avatar ?? null,
      },
    });
    createdUserIds.add(user.id);
    return user;
  }

  async function populate(user: Users, clientCount = 2) {
    await prisma.userAddress.create({
      data: {
        userId: user.id,
        addressLine1: 'Rua Um, 100',
        district: 'Centro',
        city: 'São Paulo',
        region: 'SP',
        postalCode: '01000-000',
      },
    });
    await prisma.oAuthIdentity.create({
      data: {
        provider: 'google',
        providerAccountId: `acct-${user.id}`,
        userId: user.id,
      },
    });
    await prisma.usersToken.create({ data: { userID: user.id } });
    await prisma.measurementRecord.createMany({
      data: [
        { userId: user.id, weightKg: 70, heightCm: 175 },
        { userId: user.id, weightKg: 69.5, heightCm: 175 },
        { userId: user.id, weightKg: 69, heightCm: 175 },
      ],
    });
    await seedClients(user, clientCount);
  }

  async function seedClients(professional: Users, total: number) {
    if (total === 0) {
      return;
    }
    await prisma.client.createMany({
      data: Array.from({ length: total }, (_, index) => ({
        name: `Client ${index}`,
        phone: '11999999999',
        email: `client-${index}-${professional.id}@integration.test`,
        professionalId: professional.id,
      })),
    });
  }

  async function tokenFor(user: Users): Promise<string> {
    return await jwtService.signAsync({ id: user.id, email: user.email });
  }

  // Every request carries the shared application secret, exactly as the real
  // deployment requires — so a 401 below always comes from AuthGuard.
  function call(method: 'get' | 'delete' | 'patch', path: string) {
    return request(app.getHttpServer())
      [method](path)
      .set('x-application-secret', applicationSecret);
  }

  async function ownedRowCounts(userId: string) {
    return {
      user: await prisma.users.count({ where: { id: userId } }),
      address: await prisma.userAddress.count({ where: { userId } }),
      identity: await prisma.oAuthIdentity.count({ where: { userId } }),
      tokens: await prisma.usersToken.count({ where: { userID: userId } }),
      records: await prisma.measurementRecord.count({ where: { userId } }),
      clients: await prisma.client.count({
        where: { professionalId: userId },
      }),
    };
  }

  it('IT-001 erases every owned row and answers 204', async () => {
    const user = await createUser('full', { avatar: BUCKET_AVATAR });
    await populate(user);

    expect(await ownedRowCounts(user.id)).toEqual({
      user: 1,
      address: 1,
      identity: 1,
      tokens: 1,
      records: 3,
      clients: 2,
    });

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(user)}`)
      .expect(204);

    expect(await ownedRowCounts(user.id)).toEqual({
      user: 0,
      address: 0,
      identity: 0,
      tokens: 0,
      records: 0,
      clients: 0,
    });
  });

  it('IT-002 leaves every other user untouched', async () => {
    const userA = await createUser('isolation-a');
    const userB = await createUser('isolation-b');
    await populate(userA);
    await populate(userB);

    const before = await ownedRowCounts(userB.id);
    const storedBefore = await prisma.users.findUnique({
      where: { id: userB.id },
    });

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(userA)}`)
      .expect(204);

    expect(await ownedRowCounts(userB.id)).toEqual(before);
    expect(await prisma.users.findUnique({ where: { id: userB.id } })).toEqual(
      storedBefore,
    );
    expect(await prisma.users.count({ where: { id: userA.id } })).toBe(0);
  });

  it('IT-003 refuses an unauthenticated delete and keeps the user', async () => {
    const user = await createUser('no-token');
    await populate(user);

    await call('delete', '/profile').expect(401);

    expect(await prisma.users.count({ where: { id: user.id } })).toBe(1);
  });

  it('IT-004 removes an app-hosted avatar and never an external one', async () => {
    const hosted = await createUser('hosted-avatar', { avatar: BUCKET_AVATAR });

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(hosted)}`)
      .expect(204);

    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith(BUCKET_AVATAR);

    const external = await createUser('google-avatar', {
      avatar: GOOGLE_AVATAR,
    });

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(external)}`)
      .expect(204);

    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).not.toHaveBeenCalledWith(GOOGLE_AVATAR);
  });

  it("IT-005 keeps another professional's record and only clears the link", async () => {
    const professional = await createUser('professional');
    const member = await createUser('member-client');
    await seedClients(member, 1);

    const linked = await prisma.client.create({
      data: {
        name: 'Linked client',
        phone: '11988888888',
        email: `linked-${member.id}@integration.test`,
        professionalId: professional.id,
        userId: member.id,
      },
    });

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(member)}`)
      .expect(204);

    const kept = await prisma.client.findUnique({ where: { id: linked.id } });
    expect(kept).not.toBeNull();
    expect(kept?.userId).toBeNull();
    expect(kept?.professionalId).toBe(professional.id);
    expect(
      await prisma.client.count({ where: { professionalId: member.id } }),
    ).toBe(0);
  });

  it('IT-006 ignores an id supplied in the query string or body', async () => {
    const userA = await createUser('attacker');
    const userB = await createUser('victim');
    await populate(userB);

    await call('delete', `/profile?id=${userB.id}`)
      .set('Authorization', `Bearer ${await tokenFor(userA)}`)
      .send({ id: userB.id })
      .expect(204);

    expect(await prisma.users.count({ where: { id: userA.id } })).toBe(0);
    expect(await ownedRowCounts(userB.id)).toEqual({
      user: 1,
      address: 1,
      identity: 1,
      tokens: 1,
      records: 3,
      clients: 2,
    });
  });

  it('IT-007 reports the client count on the profile response', async () => {
    const professional = await createUser('counted-professional');
    await seedClients(professional, 2);
    const member = await createUser('counted-member');

    const professionalResponse = await call('get', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(professional)}`)
      .expect(200);
    expect(professionalResponse.body.clientsCount).toBe(2);

    const memberResponse = await call('get', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(member)}`)
      .expect(200);
    expect(memberResponse.body.clientsCount).toBe(0);
  });

  it('IT-008 answers 401 when the same token is replayed after deletion', async () => {
    const user = await createUser('replay');
    await populate(user);
    const token = await tokenFor(user);

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('IT-009 no-ops a late subscription sync for a customer that no longer exists', async () => {
    const survivor = await createUser('sync-survivor');
    const before = await prisma.users.findUnique({
      where: { id: survivor.id },
    });

    const response = await call('patch', '/users/subscription/sync')
      .send({
        stripeCustomerId: `cus_deleted_${survivor.id}`,
        subscriptionStatus: 'canceled',
      })
      .expect(200);

    expect(response.body).toEqual({});
    expect(
      await prisma.users.findUnique({ where: { id: survivor.id } }),
    ).toEqual(before);
  });

  it('IT-010 deletes a user that has nothing optional attached', async () => {
    const user = await createUser('bare');

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(user)}`)
      .expect(204);

    expect(await prisma.users.count({ where: { id: user.id } })).toBe(0);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('IT-011 deletes a high-volume account within the suite timeout', async () => {
    const user = await createUser('volume');
    await prisma.measurementRecord.createMany({
      data: Array.from({ length: 500 }, (_, index) => ({
        userId: user.id,
        weightKg: 70 + index / 100,
        heightCm: 175,
      })),
    });
    await seedClients(user, 200);

    expect(
      await prisma.measurementRecord.count({ where: { userId: user.id } }),
    ).toBe(500);
    expect(
      await prisma.client.count({ where: { professionalId: user.id } }),
    ).toBe(200);

    await call('delete', '/profile')
      .set('Authorization', `Bearer ${await tokenFor(user)}`)
      .expect(204);

    expect(await ownedRowCounts(user.id)).toEqual({
      user: 0,
      address: 0,
      identity: 0,
      tokens: 0,
      records: 0,
      clients: 0,
    });
  });
});
