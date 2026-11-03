import { AcademiaProvisioningService } from '@/academia/academia.service';
import { createValidationPipe } from '@/config/validationPipe';
import { AuditLogger } from '@/auth/auditLogger.service';
import { AuthController } from '@/auth/auth.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { GoogleAuthService } from '@/auth/googleAuth.service';
import { PAYMENT_GATEWAY } from '@/billing/gateway/paymentGateway';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { ClientRegisterController } from '@/clients/register/client.register.controller';
import { ClientRegisterService } from '@/clients/register/client.register.service';
import { ApiKeyGuard } from '@/common/guards/apiKey.guard';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Clock } from '@/scheduling/clock.service';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { SignInController } from '@/users/signin/signin.controller';
import { SignInService } from '@/users/signin/signin.service';
import { SignUpController } from '@/users/signup/signup.controller';
import { SignUpService } from '@/users/signup/signup.service';
import { UserTokenService } from '@/users/token/userToken.service';
import { SubscriptionController } from '@/users/subscription/subscription.controller';
import { SubscriptionService } from '@/users/subscription/subscription.service';
import { PLATFORM_ASAAS_API_KEY } from '@/users/subscription/platformGateway.tokens';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TokenType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const MARKER = 'critsec';

describe('Critical security fixes integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const passwordHash = new PasswordHash();
  const jwtSecret = 'critical-security-fixes-jwt-secret';
  const applicationSecret = 'critical-security-fixes-application-secret';
  const createdUserIds = new Set<string>();
  const googleIdentities = new Map<
    string,
    { sub: string; email: string; name: string }
  >();
  let sequence = 0;
  let paidProductId: string;
  let groupId: string;
  const sendEmailPassword = jest.fn().mockResolvedValue(undefined);

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
        ClientRegisterController,
        ProfileController,
        SignUpController,
        SignInController,
        SubscriptionController,
        AuthController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        ClientsRepository,
        ProductsRepository,
        OAuthIdentityRepository,
        PasswordHash,
        ClientRegisterService,
        ProfileService,
        SignUpService,
        UserTokenService,
        SignInService,
        SubscriptionService,
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
        AuthService,
        AuthGuard,
        DualBucketThrottlerGuard,
        {
          provide: GoogleAuthService,
          useValue: {
            verify: jest.fn((token: string) => {
              const identity = googleIdentities.get(token);
              return identity
                ? Promise.resolve(identity)
                : Promise.reject(
                    new AppError('Falha ao entrar com Google.', 401),
                  );
            }),
          },
        },
        {
          provide: UploadService,
          useValue: { getSignedUrl: jest.fn().mockResolvedValue(null) },
        },
        { provide: MailService, useValue: { sendEmailPassword } },
        { provide: AuditLogger, useValue: { log: jest.fn(), warn: jest.fn() } },
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
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);

    // Signup needs Gratuito; the paid plan is a throwaway row removed below.
    const freeProduct = await prisma.product.findFirst({
      where: { type: 'USER', price: 0 },
    });
    if (!freeProduct) {
      throw new Error('The test database needs the Gratuito product');
    }
    const group = await prisma.productGroup.create({
      data: { name: `${MARKER} group` },
    });
    groupId = group.id;
    const paid = await prisma.product.create({
      data: {
        name: `${MARKER} Premium`,
        price: 29.9,
        type: 'USER',
        groupId,
      },
    });
    paidProductId = paid.id;
  });

  beforeEach(() => {
    sequence += 1;
    googleIdentities.clear();
  });

  afterEach(async () => {
    const ids = [...createdUserIds];
    createdUserIds.clear();
    if (ids.length === 0) {
      return;
    }
    await prisma.client.deleteMany({
      where: {
        OR: [{ professionalId: { in: ids } }, { userId: { in: ids } }],
      },
    });
    await prisma.usersToken.deleteMany({ where: { userID: { in: ids } } });
    await prisma.userAddress.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.deleteMany({
        where: { email: { endsWith: `@${MARKER}.test` } },
      });
      await prisma.product.deleteMany({ where: { groupId } });
      await prisma.productGroup.deleteMany({ where: { id: groupId } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  function email(label: string) {
    return `${label}-${sequence}-${Date.now()}@${MARKER}.test`;
  }

  async function createUser(
    label: string,
    data: Partial<Omit<Users, 'id'>> = {},
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Security ${label}`,
        email: email(label),
        password: 'unused-hash',
        active: true,
        ...data,
      },
    });
    createdUserIds.add(user.id);
    return user;
  }

  async function tokenFor(user: Users): Promise<string> {
    return await jwtService.signAsync({ id: user.id, email: user.email });
  }

  function call(method: 'get' | 'post' | 'patch', path: string) {
    return request(app.getHttpServer())
      [method](path)
      .set('x-application-secret', applicationSecret)
      .set('x-forwarded-for', `10.77.${sequence % 250}.${Date.now() % 250}`);
  }

  async function seedClient(professional: Users, clientEmail: string) {
    return await prisma.client.create({
      data: {
        name: 'Original Name',
        phone: '11999999999',
        email: clientEmail,
        professionalId: professional.id,
      },
    });
  }

  describe('POST /clients ownership (US-001)', () => {
    it("IT-001 answers 404 to another professional's client id and leaves it unchanged", async () => {
      const professionalA = await createUser('professional-a');
      const professionalB = await createUser('professional-b');
      const client = await seedClient(professionalA, email('client-c'));

      const response = await call('post', '/clients')
        .set('Authorization', `Bearer ${await tokenFor(professionalB)}`)
        .send({
          id: client.id,
          name: 'Hijacked Name',
          email: client.email,
          phone: '000',
        });

      expect(response.status).toBe(404);
      const stored = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(stored).toMatchObject({
        name: 'Original Name',
        phone: '11999999999',
        professionalId: professionalA.id,
      });
    });

    it('IT-001 answers the same 404 for an id that does not exist', async () => {
      const professionalB = await createUser('professional-b');

      await call('post', '/clients')
        .set('Authorization', `Bearer ${await tokenFor(professionalB)}`)
        .send({
          id: '01890a5d-ac96-774b-bcce-b302099a8057',
          name: 'Ghost',
          email: email('ghost'),
          phone: '000',
        })
        .expect(404);
    });

    it('rejects an id that is not a UUID before reaching the service', async () => {
      const professionalA = await createUser('professional-a');

      await call('post', '/clients')
        .set('Authorization', `Bearer ${await tokenFor(professionalA)}`)
        .send({
          id: '../profile',
          name: 'Traversal',
          email: email('traversal'),
          phone: '000',
        })
        .expect(400);
    });

    it('IT-002 still updates the calling professional’s own client', async () => {
      const professionalA = await createUser('professional-a');
      const client = await seedClient(professionalA, email('client-c'));

      const response = await call('post', '/clients')
        .set('Authorization', `Bearer ${await tokenFor(professionalA)}`)
        .send({
          id: client.id,
          name: 'Updated Name',
          email: client.email,
          phone: '11888888888',
        });

      expect(response.status).toBeLessThan(300);
      const stored = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(stored).toMatchObject({
        name: 'Updated Name',
        phone: '11888888888',
      });
    });
  });

  describe('no password in responses (US-002)', () => {
    it('IT-003 GET and POST /profile never serialize a password field', async () => {
      const user = await createUser('profile', {
        password: await passwordHash.generateHash('Secret123'),
        asaasCustomerId: `cus_${MARKER}_${sequence}_${Date.now()}`,
      });
      const auth = `Bearer ${await tokenFor(user)}`;

      const read = await call('get', '/profile')
        .set('Authorization', auth)
        .expect(200);
      const written = await call('post', '/profile')
        .set('Authorization', auth)
        .field('name', 'Renamed User')
        .field('phone', '11977777777')
        .field('addressLine1', 'Rua A, 1')
        .field('district', 'Centro')
        .field('city', 'São Paulo')
        .field('region', 'SP')
        .field('postalCode', '01000-000');

      expect(written.status).toBeLessThan(300);
      for (const response of [read, written]) {
        expect(response.text).not.toContain('"password"');
        expect(response.text).not.toContain(user.password);
      }
      expect(written.text).not.toContain(user.asaasCustomerId);
      expect(written.body).toMatchObject({
        id: user.id,
        name: 'Renamed User',
        address: { city: 'São Paulo' },
      });
    });

    it('IT-004 POST /users/signup never serializes a password field', async () => {
      const response = await call('post', '/users/signup')
        .send({
          name: 'New Signup',
          email: email('signup'),
          password: 'Str0ngPassw0rd',
          checkPassword: 'Str0ngPassw0rd',
          termsAccepted: true,
          healthDataConsent: true,
        })
        .expect(201);

      createdUserIds.add((response.body as { id: string }).id);
      expect(response.text).not.toContain('"password"');
      expect(response.body).toMatchObject({ active: false });
    });
  });

  // ADR-010: the Stripe-era "claim a subscription by id" endpoint this block
  // used to test is gone — PATCH /users/subscription/plan never takes a
  // subscription or customer id from the caller at all (it only ever acts
  // on the id already stored on the caller's own record, set exclusively by
  // the platform webhook). The forged-claim attack class this block guarded
  // against is now structurally impossible rather than merely rejected.
  describe("subscription endpoints only ever act on the caller's own record (US-003)", () => {
    async function freeUser(label: string) {
      const free = await prisma.product.findFirstOrThrow({
        where: { type: 'USER', price: 0 },
      });
      return await createUser(label, { productId: free.id });
    }

    it('IT-005 smuggled asaasCustomerId/asaasSubscriptionId fields are ignored and nothing changes', async () => {
      const user = await freeUser('forger');
      const token = await tokenFor(user);

      await call('patch', '/users/subscription/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({
          productId: paidProductId,
          asaasCustomerId: 'cus_forged',
          asaasSubscriptionId: 'sub_forged',
        })
        .expect(400); // no active subscription on file to change

      const stored = await prisma.users.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored).toMatchObject({
        productId: user.productId,
        subscriptionStatus: null,
        asaasSubscriptionId: null,
        asaasCustomerId: null,
      });
    });

    it("IT-006 an attacker with no subscription of their own can never act on another user's", async () => {
      const victimSubscriptionId = `sub_${MARKER}_${sequence}_${Date.now()}`;
      const victim = await freeUser('victim');
      await prisma.users.update({
        where: { id: victim.id },
        data: {
          productId: paidProductId,
          asaasCustomerId: `cus_${MARKER}_${sequence}_${Date.now()}`,
          asaasSubscriptionId: victimSubscriptionId,
          subscriptionStatus: 'active',
          subscriptionCurrentPeriodEnd: new Date(
            Date.now() + 10 * 24 * 60 * 60 * 1000,
          ),
        },
      });

      const attacker = await freeUser('attacker');
      const token = await tokenFor(attacker);

      // No field in the request can name the victim's subscription instead
      // of the caller's own — the endpoint resolves it only from the
      // authenticated caller's stored record.
      await call('patch', '/users/subscription/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: paidProductId })
        .expect(400);

      const victimAfter = await prisma.users.findUniqueOrThrow({
        where: { id: victim.id },
      });
      expect(victimAfter).toMatchObject({
        productId: paidProductId,
        asaasSubscriptionId: victimSubscriptionId,
      });
    });
  });

  describe('Google activation of a pre-registered account (US-004, US-005)', () => {
    it('IT-007 invalidates the earlier password and pending tokens, then links clients', async () => {
      const professional = await createUser('professional');
      const ownerEmail = email('owner');
      const client = await seedClient(professional, ownerEmail);
      const squatter = await createUser('squatter', {
        email: ownerEmail,
        password: await passwordHash.generateHash('Squatter123'),
        active: false,
      });
      await prisma.usersToken.createMany({
        data: [TokenType.ACTIVATION, TokenType.RECOVERY].map((type) => ({
          userID: squatter.id,
          type,
          tokenHash: `critsec-${type}-${squatter.id}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })),
      });
      googleIdentities.set('owner-id-token', {
        sub: `google-${sequence}-${Date.now()}`,
        email: ownerEmail,
        name: 'Real Owner',
      });

      await call('post', '/auth/google')
        .send({ idToken: 'owner-id-token' })
        .expect(201);

      const stored = await prisma.users.findUniqueOrThrow({
        where: { id: squatter.id },
      });
      expect(stored.active).toBe(true);
      await expect(
        passwordHash.compareHash('Squatter123', stored.password),
      ).resolves.toBe(false);
      await expect(
        prisma.usersToken.count({ where: { userID: squatter.id } }),
      ).resolves.toBe(0);

      const signIn = await call('post', '/users/signin').send({
        email: ownerEmail,
        password: 'Squatter123',
      });
      expect(signIn.status).toBeGreaterThanOrEqual(400);

      const linked = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(linked.userId).toBe(squatter.id);
    });
  });

  describe('client linking waits for activation (US-005)', () => {
    it('IT-008 leaves client records unlinked at signup and links them on activation', async () => {
      const professional = await createUser('professional');
      const signupEmail = email('student');
      const client = await seedClient(professional, signupEmail);

      const signup = await call('post', '/users/signup')
        .send({
          name: 'New Student',
          email: signupEmail,
          password: 'Str0ngPassw0rd',
          checkPassword: 'Str0ngPassw0rd',
          termsAccepted: true,
          healthDataConsent: true,
        })
        .expect(201);
      const userId = (signup.body as { id: string }).id;
      createdUserIds.add(userId);

      const afterSignup = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(afterSignup.userId).toBeNull();

      // Only the emailed link carries the raw token; the database has its hash.
      const link = sendEmailPassword.mock.calls.at(-1)![4] as string;
      const activated = await call('post', '/users/activate')
        .send({ token: link.split('token=')[1] })
        .expect(201);
      expect(activated.text).not.toContain('"password"');

      const afterActivation = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(afterActivation.userId).toBe(userId);
    });
  });
});
