import { AuditLogger } from '@/auth/audit-logger.service';
import { AuthController } from '@/auth/auth.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { DualBucketThrottlerGuard } from '@/auth/dual-bucket-throttler.guard';
import { GoogleAuthService } from '@/auth/google-auth.service';
import { ApiKeyGuard } from '@/common/guards/api-key.guard';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { SignUpController } from '@/users/signup/signup.controller';
import { SignUpService } from '@/users/signup/signup.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

// Every row this suite creates is tracked by id so afterEach removes exactly
// its own users and leaves the rest of the database untouched.
const MARKER = 'free-plan-e2e';
const applicationSecret = 'free-plan-e2e-secret';
const jwtSecret = 'free-plan-e2e-jwt-secret';

describe('Gratuito as a stored plan (free plan)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let freeProductId: string;
  let nutritionistProductId: string;
  let nutritionistGroupId: string;
  let requestIndex = 0;
  const createdUserIds: string[] = [];
  const temporaryProductIds: string[] = [];
  let temporaryGroupId: string | null = null;
  const tokens = new Map<
    string,
    { sub: string; email: string; name: string }
  >();
  const googleAuth = {
    verify: jest.fn().mockImplementation((token: string) => {
      const identity = tokens.get(token);
      if (!identity) {
        return Promise.reject(new AppError('Falha ao entrar com Google.', 401));
      }
      return Promise.resolve(identity);
    }),
  };

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: jwtSecret }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [
        SignUpController,
        AuthController,
        SubscriptionController,
        ProfileController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        ClientsRepository,
        ProductsRepository,
        OAuthIdentityRepository,
        PasswordHash,
        SignUpService,
        ProfileService,
        SubscriptionService,
        AuthService,
        AuthGuard,
        DualBucketThrottlerGuard,
        { provide: GoogleAuthService, useValue: googleAuth },
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: MailService,
          useValue: {
            sendEmailPassword: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditLogger, useValue: { log: jest.fn(), warn: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLICATION_SECRET' ? applicationSecret : undefined,
          },
        },
        // The real app registers this globally and the webhook sync route
        // relies on it instead of a user JWT.
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    }).compile();

    app = module.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);

    // The suite runs against whatever catalog the test database has. A
    // seeded database supplies both products; an empty one gets throwaway
    // rows that afterAll removes, so the catalog is left as it was found —
    // and in particular never gains a second product matching the free rule.
    const freeProduct = await prisma.product.findFirst({
      where: { type: 'USER', price: 0, stripeId: null },
    });
    freeProductId = freeProduct
      ? freeProduct.id
      : await createTemporaryProduct('Gratuito', 0, 'USER', null);

    const nutritionist = await prisma.product.findFirst({
      where: { type: 'NUTRITIONIST' },
    });
    if (nutritionist) {
      nutritionistProductId = nutritionist.id;
      nutritionistGroupId = nutritionist.groupId;
    } else {
      nutritionistProductId = await createTemporaryProduct(
        'Profissional',
        59.9,
        'NUTRITIONIST',
        `price_${MARKER}_nutri`,
      );
      nutritionistGroupId = temporaryGroupId as string;
    }
  });

  async function createTemporaryProduct(
    name: string,
    price: number,
    type: 'USER' | 'NUTRITIONIST',
    stripeId: string | null,
  ) {
    if (!temporaryGroupId) {
      const group = await prisma.productGroup.create({
        data: { name: `${MARKER} group` },
      });
      temporaryGroupId = group.id;
    }
    const product = await prisma.product.create({
      data: { name, price, type, stripeId, groupId: temporaryGroupId },
    });
    temporaryProductIds.push(product.id);
    return product.id;
  }

  afterEach(async () => {
    tokens.clear();
    if (createdUserIds.length === 0) {
      return;
    }
    const ids = createdUserIds.splice(0, createdUserIds.length);
    await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.usersToken.deleteMany({ where: { userID: { in: ids } } });
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      if (temporaryProductIds.length > 0) {
        await prisma.product.deleteMany({
          where: { id: { in: temporaryProductIds } },
        });
      }
      if (temporaryGroupId) {
        await prisma.productGroup.delete({ where: { id: temporaryGroupId } });
      }
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  function uniqueEmail(caseId: string) {
    return `${caseId}-${Date.now()}-${++requestIndex}@${MARKER}.test`;
  }

  function nextIp() {
    return `10.60.0.${(++requestIndex % 250) + 1}`;
  }

  async function track(email: string) {
    const user = await prisma.users.findUnique({ where: { email } });
    if (user) {
      createdUserIds.push(user.id);
    }
    return user;
  }

  function signup(email: string) {
    return request(app.getHttpServer())
      .post('/users/signup')
      .set('x-application-secret', applicationSecret)
      .set('x-forwarded-for', nextIp())
      .send({
        name: 'Free Plan E2E',
        email,
        password: 'Str0ngPassword',
        checkPassword: 'Str0ngPassword',
        termsAccepted: true,
        healthDataConsent: true,
      });
  }

  it('IT-001 creates a password signup on the free product and keeps the duplicate response', async () => {
    const email = uniqueEmail('it-001');

    await signup(email).expect(201);
    const created = await track(email);

    expect(created?.productId).toBe(freeProductId);

    const duplicate = await signup(email).expect(400);
    expect(duplicate.body.message).toBe(
      'Este e-mail já está sendo usado por outro usuário.',
    );
  });

  it('IT-002 creates a Google user on the free product', async () => {
    const email = uniqueEmail('it-002');
    tokens.set('it-002-token', {
      sub: `sub-${email}`,
      email,
      name: 'Free Plan Google',
    });

    await request(app.getHttpServer())
      .post('/auth/google')
      .set('x-application-secret', applicationSecret)
      .set('x-forwarded-for', nextIp())
      .send({ idToken: 'it-002-token' })
      .expect(201);

    const created = await track(email);

    expect(created?.productId).toBe(freeProductId);
  });

  it('IT-003 restores the free product when the webhook reports an ended subscription', async () => {
    const email = uniqueEmail('it-003');
    const user = await prisma.users.create({
      data: {
        name: 'Free Plan E2E',
        email,
        password: 'hash',
        active: true,
        productId: nutritionistProductId,
        stripeCustomerId: `cus_${MARKER}_${++requestIndex}`,
        stripeSubscriptionId: `sub_${MARKER}_${requestIndex}`,
        subscriptionStatus: 'active',
      },
    });
    createdUserIds.push(user.id);

    await request(app.getHttpServer())
      .patch('/users/subscription/sync')
      .set('x-application-secret', applicationSecret)
      .send({
        stripeCustomerId: user.stripeCustomerId,
        stripePriceId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: 'canceled',
        subscriptionCancelAt: null,
      })
      .expect(200);

    const synced = await prisma.users.findUnique({ where: { id: user.id } });

    expect(synced?.productId).toBe(freeProductId);
    expect(synced?.subscriptionStatus).toBe('canceled');
  });

  it('IT-004 exposes the product type and group on the profile', async () => {
    const professional = await prisma.users.create({
      data: {
        name: 'Free Plan E2E',
        email: uniqueEmail('it-004-nutri'),
        password: 'hash',
        active: true,
        productId: nutritionistProductId,
      },
    });
    const member = await prisma.users.create({
      data: {
        name: 'Free Plan E2E',
        email: uniqueEmail('it-004-free'),
        password: 'hash',
        active: true,
        productId: freeProductId,
      },
    });
    createdUserIds.push(professional.id, member.id);

    const profileOf = async (id: string, email: string) => {
      const token = await jwtService.signAsync({ id, email });
      const response = await request(app.getHttpServer())
        .get('/profile')
        .set('x-application-secret', applicationSecret)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return response.body as Record<string, unknown>;
    };

    const professionalProfile = await profileOf(
      professional.id,
      professional.email,
    );
    expect(professionalProfile.productType).toBe('NUTRITIONIST');
    expect(professionalProfile.productGroupId).toBe(nutritionistGroupId);

    const memberProfile = await profileOf(member.id, member.email);
    expect(memberProfile.productType).toBe('USER');
    expect(memberProfile.productGroupId).toEqual(expect.any(String));
  });
});
