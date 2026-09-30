/**
 * Integration tests for PRD `progress-photos` (task_02, backend).
 *
 * Runs the real ProgressPhotosController/ProgressPhotosService/
 * repositories/AuthGuard/PremiumGuard/ConsentService and the app's global
 * ValidationPipe against an isolated database. Only `UploadService` is
 * replaced with a mock at the module boundary (TechSpec § Testing
 * Approach) — no automated test makes a real GCS call.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { PremiumGuard } from '@/common/guards/premium.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ProgressPhotosController } from '@/progress-photos/progressPhotos.controller';
import { ProgressPhotosService } from '@/progress-photos/progressPhotos.service';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `pp-${Date.now()}`;

// A real PNG signature so the app's byte-content validation accepts it —
// the e2e jest config has no `mock/` module root, so this mirrors
// `mock/imageFile.mock.ts`'s PNG_BYTES inline rather than importing it.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);

describe('Progress Photos integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let freeUser: Users;
  let premiumUser: Users;
  let premiumGroupId: string;
  const uploadImage = jest.fn();
  const getSignedUrl = jest.fn();
  const deleteImage = jest.fn();
  const jwtSecret = 'progress-photos-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ProgressPhotosController],
      providers: [
        PrismaService,
        UserRepository,
        ProgressPhotosRepository,
        ConsentRepository,
        ConsentService,
        PremiumGuard,
        ProgressPhotosService,
        AuthGuard,
        {
          provide: UploadService,
          useValue: { uploadImage, getSignedUrl, deleteImage },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seedUsers();
  });

  beforeEach(() => {
    uploadImage.mockReset();
    getSignedUrl.mockReset();
    deleteImage.mockReset();
    getSignedUrl.mockImplementation((filename: string) =>
      Promise.resolve(`https://signed.example/${filename}?sig=x`),
    );
  });

  afterEach(async () => {
    await prisma.progressPhoto.deleteMany({
      where: { userId: { in: [freeUser.id, premiumUser.id] } },
    });
    await prisma.featureConsent.deleteMany({
      where: { userId: { in: [freeUser.id, premiumUser.id] } },
    });
  });

  afterAll(async () => {
    const userIds = [freeUser, premiumUser].filter(Boolean).map((u) => u.id);
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId: premiumGroupId } });
    await prisma.productGroup.deleteMany({ where: { id: premiumGroupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} premium group`,
        products: {
          create: {
            name: `${RUN_TAG} premium`,
            price: 49,
            type: ProductType.USER,
          },
        },
      },
      include: { products: true },
    });
    premiumGroupId = group.id;

    freeUser = await createUser('free', {});
    premiumUser = await createUser('premium', {
      productId: group.products[0].id,
      subscriptionStatus: 'active',
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Progress Photos ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function bearerFor(user: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function giveConsent(auth: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/progress-photos/consent')
      .set('Authorization', auth);
  }

  it('IT-001 consent gate: rejected before consent, allowed after', async () => {
    const auth = await bearerFor(premiumUser);
    uploadImage.mockResolvedValue(
      'https://storage.googleapis.com/bucket/it-001.png',
    );

    const before = await request(app.getHttpServer())
      .get('/progress-photos/consent')
      .set('Authorization', auth);
    expect(before.body.consented).toBe(false);

    const rejected = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    expect(rejected.status).toBe(403);

    const consentGrant = await request(app.getHttpServer())
      .post('/progress-photos/consent')
      .set('Authorization', auth);
    expect(consentGrant.status).toBe(204);

    const allowed = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    expect(allowed.status).toBe(201);
  });

  it('IT-002 the second upload for the same angle includes previousPhotoUrl', async () => {
    const auth = await bearerFor(premiumUser);
    await giveConsent(auth);
    uploadImage
      .mockResolvedValueOnce('https://storage.googleapis.com/bucket/first.png')
      .mockResolvedValueOnce(
        'https://storage.googleapis.com/bucket/second.png',
      );

    const first = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    expect(first.body.previousPhotoUrl).toBeUndefined();

    const second = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    expect(second.status).toBe(201);
    expect(second.body.previousPhotoUrl).toContain('first.png');
  });

  it('IT-003 lists only the requested angle, each with a signed-URL shape', async () => {
    const auth = await bearerFor(premiumUser);
    await giveConsent(auth);
    uploadImage
      .mockResolvedValueOnce('https://storage.googleapis.com/bucket/front.png')
      .mockResolvedValueOnce('https://storage.googleapis.com/bucket/side.png');

    await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'SIDE')
      .attach('file', PNG_BYTES, 'photo.png');

    const sideOnly = await request(app.getHttpServer())
      .get('/progress-photos?angle=SIDE')
      .set('Authorization', auth);

    expect(sideOnly.body).toHaveLength(1);
    expect(sideOnly.body[0].angle).toBe('SIDE');
    expect(sideOnly.body[0].signedUrl).toMatch(/^https:\/\/signed\.example\//);
  });

  it('IT-004 compares two same-angle photos, rejects two different-angle photos', async () => {
    const auth = await bearerFor(premiumUser);
    await giveConsent(auth);
    uploadImage
      .mockResolvedValueOnce(
        'https://storage.googleapis.com/bucket/front-1.png',
      )
      .mockResolvedValueOnce(
        'https://storage.googleapis.com/bucket/front-2.png',
      )
      .mockResolvedValueOnce(
        'https://storage.googleapis.com/bucket/side-1.png',
      );

    const frontA = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    const frontB = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    const side = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'SIDE')
      .attach('file', PNG_BYTES, 'photo.png');

    const sameAngle = await request(app.getHttpServer())
      .get(`/progress-photos/compare?a=${frontA.body.id}&b=${frontB.body.id}`)
      .set('Authorization', auth);
    expect(sameAngle.status).toBe(200);

    const crossAngle = await request(app.getHttpServer())
      .get(`/progress-photos/compare?a=${frontA.body.id}&b=${side.body.id}`)
      .set('Authorization', auth);
    expect(crossAngle.status).toBe(400);
  });

  it('IT-005 deletes the row and calls UploadService.deleteImage exactly once', async () => {
    const auth = await bearerFor(premiumUser);
    await giveConsent(auth);
    uploadImage.mockResolvedValueOnce(
      'https://storage.googleapis.com/bucket/to-delete.png',
    );
    deleteImage.mockResolvedValue(undefined);

    const uploaded = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'BACK')
      .attach('file', PNG_BYTES, 'photo.png');

    const deleted = await request(app.getHttpServer())
      .delete(`/progress-photos/${uploaded.body.id}`)
      .set('Authorization', auth);
    expect(deleted.status).toBe(204);
    expect(deleteImage).toHaveBeenCalledTimes(1);

    const afterDelete = await request(app.getHttpServer())
      .get('/progress-photos?angle=BACK')
      .set('Authorization', auth);
    expect(
      afterDelete.body.find(
        (photo: { id: string }) => photo.id === uploaded.body.id,
      ),
    ).toBeUndefined();
  });

  it('IT-006 every route is 402 for a Free-tier user, including the consent routes', async () => {
    const auth = await bearerFor(freeUser);

    const getConsent = await request(app.getHttpServer())
      .get('/progress-photos/consent')
      .set('Authorization', auth);
    expect(getConsent.status).toBe(402);

    const postConsent = await request(app.getHttpServer())
      .post('/progress-photos/consent')
      .set('Authorization', auth);
    expect(postConsent.status).toBe(402);

    const upload = await request(app.getHttpServer())
      .post('/progress-photos')
      .set('Authorization', auth)
      .field('angle', 'FRONT')
      .attach('file', PNG_BYTES, 'photo.png');
    expect(upload.status).toBe(402);

    const list = await request(app.getHttpServer())
      .get('/progress-photos?angle=FRONT')
      .set('Authorization', auth);
    expect(list.status).toBe(402);

    const compare = await request(app.getHttpServer())
      .get(
        '/progress-photos/compare?a=00000000-0000-0000-0000-000000000000&b=00000000-0000-0000-0000-000000000001',
      )
      .set('Authorization', auth);
    expect(compare.status).toBe(402);

    const deleteRoute = await request(app.getHttpServer())
      .delete('/progress-photos/00000000-0000-0000-0000-000000000000')
      .set('Authorization', auth);
    expect(deleteRoute.status).toBe(402);

    expect(uploadImage).not.toHaveBeenCalled();
  });
});
