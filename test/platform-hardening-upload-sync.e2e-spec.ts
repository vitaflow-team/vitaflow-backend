import { AcademiaProvisioningService } from '@/academia/academia.service';
import { AuthGuard } from '@/auth/auth.guard';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { ApiKeyGuard } from '@/common/guards/apiKey.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { AVATAR_MAX_BYTES } from '@/users/profile/avatarUpload';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { SubscriptionWebhookController } from '@/users/subscription/subscriptionWebhook.controller';
import { SubscriptionWebhookService } from '@/users/subscription/subscriptionWebhook.service';
import {
  PLATFORM_ASAAS_API_KEY,
  PLATFORM_WEBHOOK_TOKEN,
} from '@/users/subscription/platformGateway.tokens';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PNG_BYTES } from '../mock/imageFile.mock';

// Google Cloud Storage is the only stubbed dependency: every object name the
// real UploadService writes is recorded, the database is the real one.
const writtenObjects: string[] = [];
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: jest.fn((name: string) => ({
      name,
      file: jest.fn((objectName: string) => ({
        createWriteStream: jest.fn(() => {
          writtenObjects.push(objectName);
          const handlers: Record<string, () => void> = {};
          const stream = {
            on: (event: string, handler: () => void) => {
              handlers[event] = handler;
              return stream;
            },
            end: () => setImmediate(() => handlers.finish?.()),
          };
          return stream;
        }),
        exists: jest.fn().mockResolvedValue([false]),
        delete: jest.fn().mockResolvedValue(undefined),
        getSignedUrl: jest
          .fn()
          .mockResolvedValue(['https://signed.test/avatar.png']),
      })),
    })),
  })),
}));

jest.setTimeout(60_000);

const BUCKET = 'test-bucket';
const EMAIL_DOMAIN = '@platform-upload-sync.test';
const ADDRESS = {
  addressLine1: 'Rua Um, 100',
  district: 'Centro',
  city: 'São Paulo',
  region: 'SP',
  postalCode: '01000-000',
};

describe('Platform hardening — avatar uploads and subscription sync', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const jwtSecret = 'platform-upload-sync-jwt-secret-0123456789';
  const applicationSecret = 'platform-upload-sync-application-secret';
  const webhookToken = 'platform-upload-sync-webhook-token';
  let sequence = 0;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.GCP_CLIENT_EMAIL = 'test@integration.test';
    process.env.GCP_PRIVATE_KEY = 'test-private-key';
    process.env.GCP_BUCKET = BUCKET;

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [
        ProfileController,
        SubscriptionController,
        SubscriptionWebhookController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        ProductsRepository,
        UploadService,
        ProfileService,
        SubscriptionService,
        SubscriptionWebhookService,
        Clock,
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: AcademiaProvisioningService,
          useValue: { provisionForOwner: jest.fn() },
        },
        {
          provide: TemplatesService,
          useValue: { ensureStarterTemplates: jest.fn() },
        },
        {
          provide: PAYMENT_GATEWAY,
          useValue: {
            createSubscriptionCheckout: jest.fn(),
            updateSubscription: jest.fn(),
            createCharge: jest.fn(),
          },
        },
        { provide: PLATFORM_ASAAS_API_KEY, useValue: 'test-platform-key' },
        { provide: PLATFORM_WEBHOOK_TOKEN, useValue: webhookToken },
        AuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLICATION_SECRET' ? applicationSecret : undefined,
          },
        },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  async function cleanUp() {
    const users = { email: { endsWith: EMAIL_DOMAIN } };
    await prisma.userAddress.deleteMany({ where: { user: users } });
    await prisma.users.deleteMany({ where: users });
  }

  beforeEach(async () => {
    sequence += 1;
    writtenObjects.length = 0;
    await cleanUp();
  });

  afterAll(async () => {
    if (prisma) {
      await cleanUp();
      await prisma.$disconnect();
    }
    await app?.close();
  });

  function createUser(data: Partial<Users> = {}): Promise<Users> {
    return prisma.users.create({
      data: {
        name: 'Upload Sync',
        email: `user-${sequence}-${Date.now()}${EMAIL_DOMAIN}`,
        password: 'unused-in-integration-test',
        active: true,
        ...data,
      },
    });
  }

  async function postAvatar(
    user: Users,
    file: { buffer: Buffer; filename: string; contentType: string },
  ) {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    let call = request(app.getHttpServer())
      .post('/profile')
      .set('x-application-secret', applicationSecret)
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Upload Sync');
    for (const [key, value] of Object.entries(ADDRESS)) {
      call = call.field(key, value);
    }
    return call.attach('avatar', file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  describe('IT-005 avatar upload hardening', () => {
    it('rejects an avatar over 2 MB before storage', async () => {
      const user = await createUser();
      const oversized = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(AVATAR_MAX_BYTES + 1),
      ]);

      const response = await postAvatar(user, {
        buffer: oversized,
        filename: 'big.png',
        contentType: 'image/png',
      });
      expect(response.status).toBe(413);

      expect(writtenObjects).toEqual([]);
      const stored = await prisma.users.findUnique({ where: { id: user.id } });
      expect(stored?.avatar).toBeNull();
    });

    it('rejects a declared non-image type', async () => {
      const user = await createUser();

      const response = await postAvatar(user, {
        buffer: Buffer.from('plain text'),
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
      expect(response.status).toBe(400);

      expect(writtenObjects).toEqual([]);
    });

    it('rejects a renamed non-image that claims to be a PNG', async () => {
      const user = await createUser();

      const response = await postAvatar(user, {
        buffer: Buffer.from('#!/bin/sh\necho not an image\n'),
        filename: 'photo.png',
        contentType: 'image/png',
      });
      expect(response.status).toBe(400);

      expect(writtenObjects).toEqual([]);
    });

    it('stores a valid image under a server-generated name', async () => {
      const user = await createUser();

      const response = await postAvatar(user, {
        buffer: PNG_BYTES,
        filename: '..%2F..%2Fmy-holiday-photo.png',
        contentType: 'image/png',
      });
      expect(response.status).toBe(201);

      expect(writtenObjects).toHaveLength(1);
      const [objectName] = writtenObjects;
      expect(objectName).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(objectName).not.toContain('holiday');

      const stored = await prisma.users.findUnique({ where: { id: user.id } });
      expect(stored?.avatar).toBe(
        `https://storage.googleapis.com/${BUCKET}/${objectName}`,
      );
    });
  });

  describe('IT-008 subscription webhook relink guard', () => {
    function sync(asaasCustomerId: string, userId: string) {
      return request(app.getHttpServer())
        .post('/users/subscription/webhook')
        .set('asaas-access-token', webhookToken)
        .send({
          event: 'SUBSCRIPTION_UPDATED',
          subscription: {
            id: `sub_${asaasCustomerId}`,
            customer: asaasCustomerId,
            externalReference: `${userId}:`,
          },
        })
        .expect(200);
    }

    it('persists no change when relinking a user who already has a different customer id', async () => {
      const existing = `cus_existing_${sequence}_${Date.now()}`;
      const user = await createUser({
        asaasCustomerId: existing,
        asaasSubscriptionId: 'sub_original',
        subscriptionStatus: 'active',
      });

      await sync(`cus_other_${sequence}_${Date.now()}`, user.id);

      const stored = await prisma.users.findUnique({ where: { id: user.id } });
      expect(stored?.asaasCustomerId).toBe(existing);
      expect(stored?.asaasSubscriptionId).toBe('sub_original');
    });

    it('links a brand-new customer id to a user with none yet', async () => {
      const user = await createUser();
      const customerId = `cus_new_${sequence}_${Date.now()}`;

      await sync(customerId, user.id);

      const stored = await prisma.users.findUnique({ where: { id: user.id } });
      expect(stored?.asaasCustomerId).toBe(customerId);
      expect(stored?.asaasSubscriptionId).toBe(`sub_${customerId}`);
    });

    it('keeps a retried delivery for an already-linked pair a harmless no-op', async () => {
      const customerId = `cus_linked_${sequence}_${Date.now()}`;
      const user = await createUser({ asaasCustomerId: customerId });

      await sync(customerId, user.id);
      await sync(customerId, user.id);

      const stored = await prisma.users.findUnique({ where: { id: user.id } });
      expect(stored?.asaasCustomerId).toBe(customerId);
    });
  });
});
