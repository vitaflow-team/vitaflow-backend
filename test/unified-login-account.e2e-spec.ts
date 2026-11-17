/**
 * Integration tests for PRD `unified-login-account`.
 *
 * Runs the real staff, profile, Google sign-in and password sign-in
 * controllers, their services, the repositories, AuthGuard, BackofficeGuard,
 * AdminTierGuard and the app's global ValidationPipe against an isolated
 * database. Google token verification and outgoing mail are the only fakes:
 * `GoogleAuthService.verify` returns the identity registered for a token, and
 * the mail double records the links a real inbox would receive.
 *
 * IT-001 through IT-004 (the duplicate correction and the unique index) are
 * not here: they run the migration body in a throwaway schema, through
 * `prisma/checks/unify-users-email.sql`.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AcademiaStaffAuthService } from '@/academia/staff/academiaStaffAuth.service';
import { AuditLogger } from '@/auth/auditLogger.service';
import { AuthController } from '@/auth/auth.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { GoogleAuthService } from '@/auth/googleAuth.service';
import { GoogleLinkController } from '@/auth/googleLink.controller';
import { BackofficeStaffController } from '@/backoffice/staff/backofficeStaff.controller';
import { BackofficeStaffService } from '@/backoffice/staff/backofficeStaff.service';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AcademiaStaffMemberTokenRepository } from '@/repositories/academia/academiaStaffMemberToken.repository';
import { OAuthIdentityRepository } from '@/repositories/auth/oauthIdentity.repository';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProductsRepository } from '@/repositories/product/product.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { RecoverpassController } from '@/users/recoverpass/recoverpass.controller';
import { RecoverpassService } from '@/users/recoverpass/recoverpass.service';
import { SignInController } from '@/users/signin/signin.controller';
import { SignInService } from '@/users/signin/signin.service';
import { SignUpController } from '@/users/signup/signup.controller';
import { SignUpService } from '@/users/signup/signup.service';
import { UserTokenService } from '@/users/token/userToken.service';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { BackofficeTier, Prisma, ProductType, Users } from '@prisma/client';
import { hash } from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(120_000);

const RUN_TAG = `unified-login-${Date.now()}`;
const PASSWORD = 'SenhaAtual123';
const JWT_SECRET = 'unified-login-account-integration-jwt-secret';
// Seeding only: the real PasswordHash still verifies it, at a fraction of
// the cost of the production work factor.
const SEED_BCRYPT_COST = 4;

describe('Unified login account — integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let passwordHash: string;
  let freeProductId: string;
  let groupId: string;
  const createdAcademiaIds: string[] = [];
  const mail = {
    sendEmailPassword: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  };
  const googleTokens = new Map<string, { sub: string; email: string }>();
  const googleAuth = {
    verify: jest.fn((token: string) => {
      const identity = googleTokens.get(token);
      return identity
        ? Promise.resolve({ ...identity, name: 'Google User' })
        : Promise.reject(new AppError('Falha ao entrar com Google.', 401));
    }),
  };

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.APP_URL = 'https://app.vitaflow.test';

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: JWT_SECRET }),
        // Rate limiting is covered by its own suites; a high ceiling keeps
        // the many token attempts in this file from tripping it.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
      ],
      controllers: [
        BackofficeStaffController,
        ProfileController,
        AuthController,
        GoogleLinkController,
        SignInController,
        SignUpController,
        RecoverpassController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        UserTokenService,
        OAuthIdentityRepository,
        ProductsRepository,
        ClientsRepository,
        ProgressPhotosRepository,
        BackofficeViewAsSessionRepository,
        PasswordHash,
        BackofficeStaffService,
        ProfileService,
        AuthService,
        SignInService,
        SignUpService,
        RecoverpassService,
        AcademiaStaffMemberRepository,
        AcademiaStaffMemberTokenRepository,
        AcademiaStaffAuthService,
        AuthGuard,
        BackofficeGuard,
        AdminTierGuard,
        DualBucketThrottlerGuard,
        { provide: GoogleAuthService, useValue: googleAuth },
        { provide: MailService, useValue: mail },
        { provide: AuditLogger, useValue: { log: jest.fn(), warn: jest.fn() } },
        {
          provide: UploadService,
          useValue: {
            getSignedUrl: jest.fn().mockResolvedValue(null),
            isBucketUrl: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();
    module.useLogger(false);

    app = module.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
    passwordHash = await hash(PASSWORD, SEED_BCRYPT_COST);

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            { name: `${RUN_TAG} free`, price: 0, type: ProductType.USER },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    freeProductId = group.products[0].id;
  });

  afterEach(async () => {
    await removeRunUsers();
    googleTokens.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (prisma) {
      await removeRunUsers();
      await prisma.academiaStaffMember.deleteMany({
        where: { academiaId: { in: createdAcademiaIds } },
      });
      await prisma.academia.deleteMany({
        where: { id: { in: createdAcademiaIds } },
      });
      if (groupId) {
        await prisma.product.deleteMany({ where: { groupId } });
        await prisma.productGroup.deleteMany({ where: { id: groupId } });
      }
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  // Every account this suite creates carries RUN_TAG in its email, including
  // the ones the endpoints themselves create — so cleanup never depends on
  // a test having recorded an id.
  async function removeRunUsers(): Promise<void> {
    const owned = { user: { email: { startsWith: RUN_TAG } } };
    await prisma.usersToken.deleteMany({ where: owned });
    await prisma.oAuthIdentity.deleteMany({ where: owned });
    await prisma.users.deleteMany({
      where: { email: { startsWith: RUN_TAG } },
    });
  }

  const emailFor = (label: string) => `${RUN_TAG}-${label}@integration.test`;

  async function createAccount(
    label: string,
    overrides: Partial<Prisma.UsersUncheckedCreateInput> = {},
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Conta ${label}`,
        email: emailFor(label),
        password: passwordHash,
        active: true,
        productId: freeProductId,
        ...overrides,
      },
    });
  }

  const createStaff = (label: string, tier: BackofficeTier) =>
    createAccount(label, {
      isBackoffice: true,
      backofficeTier: tier,
      productId: null,
    });

  async function bearerFor(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  async function asUser(target: Users) {
    const auth = await bearerFor(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      delete: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  const anonymous = {
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).send(body),
  };

  // The raw token only ever exists in the emailed link; the mail double
  // lets a test recover it the same way a real inbox would.
  function lastInvitationToken(): string {
    const link = mail.sendNotificationEmail.mock.calls.at(-1)![4] as string;
    expect(link).toContain('/signin/accept-backoffice-staff?token=');
    return new URL(link).searchParams.get('token')!;
  }

  async function inviteExisting(
    admin: Users,
    target: Users,
    tier: BackofficeTier = BackofficeTier.EQUIPE,
  ): Promise<string> {
    const caller = await asUser(admin);
    const invite = await caller.post('/backoffice/staff', {
      email: target.email,
      tier,
    });
    expect(invite.status).toBe(201);
    return lastInvitationToken();
  }

  function signInWithGoogle(sub: string, email: string) {
    const idToken = `google-${sub}`;
    googleTokens.set(idToken, { sub, email });
    return anonymous.post('/auth/google', { idToken });
  }

  const signInWithPassword = (email: string, password = PASSWORD) =>
    anonymous.post('/users/signin', { email, password });

  const signUp = (email: string) =>
    anonymous.post('/users/signup', {
      name: 'Nova Conta',
      email,
      password: PASSWORD,
      checkPassword: PASSWORD,
      termsAccepted: true,
      healthDataConsent: true,
    });

  // Registers the Google identity a token stands for, then links it to the
  // signed-in account with the given intent.
  async function linkGoogle(
    owner: Users,
    intent: string,
    google: { sub: string; email: string },
  ) {
    const idToken = `google-${google.sub}`;
    googleTokens.set(idToken, google);
    return (await asUser(owner)).post('/auth/google/link', {
      idToken,
      intent,
    });
  }

  async function linkIntent(owner: Users, password?: string) {
    return (await asUser(owner)).post(
      '/auth/google/link-intent',
      password === undefined ? {} : { password },
    );
  }

  // The recovery email is sent off the response path, so the test waits
  // for the mail double to receive it instead of assuming it already has.
  async function lastRecoveryToken(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const call = mail.sendEmailPassword.mock.calls.find(
        (args) => args[3] === './resetpassword',
      );
      if (call) {
        return new URL(call[4] as string).searchParams.get('token')!;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('no recovery email was sent');
  }

  const reload = (id: string) =>
    prisma.users.findUniqueOrThrow({ where: { id } });

  const countAccounts = (email: string) =>
    prisma.users.count({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

  describe('staff invitation on the existing account (US-007, US-008)', () => {
    it('IT-014 an invited existing account is unchanged until its owner accepts with the password', async () => {
      const admin = await createStaff('it014-admin', BackofficeTier.ADMIN);
      const account = await createAccount('it014-account');

      const token = await inviteExisting(admin, account, BackofficeTier.ADMIN);

      const pending = await reload(account.id);
      expect(pending.isBackoffice).toBe(false);
      expect(pending.pendingBackofficeTier).toBe(BackofficeTier.ADMIN);
      expect(pending.password).toBe(account.password);
      expect(pending.productId).toBe(freeProductId);
      await expect(countAccounts(account.email)).resolves.toBe(1);

      const list = await (await asUser(admin)).get('/backoffice/staff');
      expect(list.status).toBe(200);
      expect(
        (list.body as { id: string }[]).find((item) => item.id === account.id),
      ).toMatchObject({ pending: true, tier: BackofficeTier.ADMIN });

      const preview = await anonymous.post(
        '/backoffice/staff/invitation/preview',
        { token },
      );
      expect(preview.status).toBe(201);
      expect(preview.body).toEqual({
        tier: BackofficeTier.ADMIN,
        googleLinked: false,
      });

      const accept = await anonymous.post('/backoffice/staff/accept', {
        token,
        password: PASSWORD,
      });
      expect(accept.status).toBe(201);

      const granted = await reload(account.id);
      expect(granted.isBackoffice).toBe(true);
      expect(granted.backofficeTier).toBe(BackofficeTier.ADMIN);
      expect(granted.pendingBackofficeTier).toBeNull();
      expect(granted.password).toBe(account.password);
      expect(granted.productId).toBe(freeProductId);

      const signIn = await signInWithPassword(account.email);
      expect(signIn.status).toBe(201);
      expect(signIn.body.id).toBe(account.id);
    });

    it('IT-015 a wrong password keeps the link valid; expired, random, used and orphaned links are refused', async () => {
      const admin = await createStaff('it015-admin', BackofficeTier.ADMIN);
      const account = await createAccount('it015-account');
      const token = await inviteExisting(admin, account);
      const accept = (password: string, value = token) =>
        anonymous.post('/backoffice/staff/accept', { token: value, password });

      const wrong = await accept('SenhaErrada999');
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('invalid_password');
      expect((await reload(account.id)).isBackoffice).toBe(false);

      const random = await accept(PASSWORD, 'not-a-real-token');
      expect(random.status).toBe(400);
      expect(random.body.code).toBe('invalid_token');

      const right = await accept(PASSWORD);
      expect(right.status).toBe(201);

      const reused = await accept(PASSWORD);
      expect(reused.status).toBe(400);
      expect(reused.body.code).toBe('invalid_token');
      expect((await reload(account.id)).isBackoffice).toBe(true);
    });

    it('IT-015 an expired link, an inactive account and a deleted account are refused', async () => {
      const admin = await createStaff('it015b-admin', BackofficeTier.ADMIN);

      const expired = await createAccount('it015b-expired');
      const expiredToken = await inviteExisting(admin, expired);
      await prisma.usersToken.updateMany({
        where: { userID: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const afterExpiry = await anonymous.post('/backoffice/staff/accept', {
        token: expiredToken,
        password: PASSWORD,
      });
      expect(afterExpiry.status).toBe(400);
      expect(afterExpiry.body.code).toBe('invalid_token');

      const inactive = await createAccount('it015b-inactive');
      const inactiveToken = await inviteExisting(admin, inactive);
      await prisma.users.update({
        where: { id: inactive.id },
        data: { active: false },
      });
      const whileInactive = await anonymous.post('/backoffice/staff/accept', {
        token: inactiveToken,
        password: PASSWORD,
      });
      expect(whileInactive.status).toBe(409);
      expect(whileInactive.body.code).toBe('account_inactive');
      expect((await reload(inactive.id)).isBackoffice).toBe(false);

      const deleted = await createAccount('it015b-deleted');
      const deletedToken = await inviteExisting(admin, deleted);
      const removal = await (await asUser(deleted)).delete('/profile');
      expect(removal.status).toBe(204);
      const afterDeletion = await anonymous.post('/backoffice/staff/accept', {
        token: deletedToken,
        password: PASSWORD,
      });
      expect(afterDeletion.status).toBe(400);
      expect(afterDeletion.body.code).toBe('invalid_token');
    });

    it('IT-016 duplicate invites are refused, a re-sent link replaces the previous one, and only admins invite', async () => {
      const admin = await createStaff('it016-admin', BackofficeTier.ADMIN);
      const equipe = await createStaff('it016-equipe', BackofficeTier.EQUIPE);
      const account = await createAccount('it016-account');
      const caller = await asUser(admin);
      const invite = (email: string) =>
        caller.post('/backoffice/staff', {
          email,
          tier: BackofficeTier.EQUIPE,
        });

      const alreadyStaff = await invite(equipe.email);
      expect(alreadyStaff.status).toBe(409);
      expect(alreadyStaff.body.code).toBe('already_staff');

      const firstToken = await inviteExisting(admin, account);
      const second = await invite(account.email);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('invitation_pending');

      const resend = await caller.post(
        `/backoffice/staff/${account.id}/resend`,
      );
      expect(resend.status).toBe(201);
      const secondToken = lastInvitationToken();
      expect(secondToken).not.toBe(firstToken);

      const preview = (token: string) =>
        anonymous.post('/backoffice/staff/invitation/preview', { token });
      expect((await preview(firstToken)).status).toBe(400);
      expect((await preview(secondToken)).status).toBe(201);

      const notPending = await caller.post(
        `/backoffice/staff/${equipe.id}/resend`,
      );
      expect(notPending.status).toBe(409);
      expect(notPending.body.code).toBe('not_pending');

      const byEquipe = await (
        await asUser(equipe)
      ).post('/backoffice/staff', {
        email: emailFor('it016-other'),
        tier: BackofficeTier.EQUIPE,
      });
      expect(byEquipe.status).toBe(403);
      await expect(countAccounts(emailFor('it016-other'))).resolves.toBe(0);
    });
  });

  describe('removing staff access (US-009)', () => {
    it('IT-017 removal withdraws access only, and the account then links to Google on its own', async () => {
      const admin = await createStaff('it017-admin', BackofficeTier.ADMIN);
      const account = await createAccount('it017-account');
      const token = await inviteExisting(admin, account);
      await anonymous.post('/backoffice/staff/accept', {
        token,
        password: PASSWORD,
      });
      const member = await reload(account.id);
      expect((await (await asUser(member)).get('/profile')).status).toBe(200);

      const caller = await asUser(admin);
      const removal = await caller.delete(`/backoffice/staff/${account.id}`);
      expect(removal.status).toBe(200);

      const blocked = await (await asUser(member)).get('/backoffice/staff');
      expect(blocked.status).toBe(403);

      const afterRemoval = await reload(account.id);
      expect(afterRemoval.isBackoffice).toBe(false);
      expect(afterRemoval.productId).toBe(freeProductId);
      expect(afterRemoval.password).toBe(account.password);

      const signIn = await signInWithPassword(account.email);
      expect(signIn.status).toBe(201);
      expect(signIn.body.id).toBe(account.id);

      const google = await signInWithGoogle('it017-sub', account.email);
      expect(google.status).toBe(201);
      expect(google.body.id).toBe(account.id);
      await expect(
        prisma.oAuthIdentity.count({ where: { userId: account.id } }),
      ).resolves.toBe(1);
    });

    it('IT-017 cancelling a pending invitation clears it and kills its link; the last admin stays', async () => {
      const admin = await createStaff('it017b-admin', BackofficeTier.ADMIN);
      const account = await createAccount('it017b-account');
      const token = await inviteExisting(admin, account);
      const caller = await asUser(admin);

      const cancel = await caller.delete(`/backoffice/staff/${account.id}`);
      expect(cancel.status).toBe(200);

      const cancelled = await reload(account.id);
      expect(cancelled.pendingBackofficeTier).toBeNull();
      expect(cancelled.isBackoffice).toBe(false);
      expect(cancelled.productId).toBe(freeProductId);

      const preview = await anonymous.post(
        '/backoffice/staff/invitation/preview',
        { token },
      );
      expect(preview.status).toBe(400);
      const accept = await anonymous.post('/backoffice/staff/accept', {
        token,
        password: PASSWORD,
      });
      expect(accept.status).toBe(400);

      // The invariant counts every admin in the database, so it is only
      // asserted when this run's admin is in fact the last one.
      const admins = await prisma.users.count({
        where: { isBackoffice: true, backofficeTier: BackofficeTier.ADMIN },
      });
      expect(admins).toBe(1);
      const lastAdmin = await caller.delete(`/backoffice/staff/${admin.id}`);
      expect(lastAdmin.status).toBe(409);
      expect(lastAdmin.body.code).toBe('last_admin_required');
      expect((await reload(admin.id)).isBackoffice).toBe(true);
    });

    it('IT-018 a Google link held before acceptance survives it and then carries staff access', async () => {
      const admin = await createStaff('it018-admin', BackofficeTier.ADMIN);
      const account = await createAccount('it018-account');
      const linked = await signInWithGoogle('it018-sub', account.email);
      expect(linked.body.id).toBe(account.id);

      const token = await inviteExisting(admin, account);
      const preview = await anonymous.post(
        '/backoffice/staff/invitation/preview',
        { token },
      );
      expect(preview.body.googleLinked).toBe(true);

      const accept = await anonymous.post('/backoffice/staff/accept', {
        token,
        password: PASSWORD,
      });
      expect(accept.status).toBe(201);

      const google = await signInWithGoogle('it018-sub', account.email);
      expect(google.status).toBe(201);
      expect(google.body.id).toBe(account.id);
      expect((await reload(account.id)).isBackoffice).toBe(true);
      await expect(countAccounts(account.email)).resolves.toBe(1);
    });
  });

  describe('customer opt-in and profile fields (US-011, US-005)', () => {
    const consent = { termsAccepted: true, healthDataConsent: true };

    it('IT-019 a plan-less account opts in once, on the same account', async () => {
      const staffOnly = await createStaff('it019-staff', BackofficeTier.EQUIPE);
      const caller = await asUser(staffOnly);

      const refused = await caller.post('/profile/customer-activation', {
        ...consent,
        termsAccepted: false,
      });
      expect(refused.status).toBe(400);
      expect((await reload(staffOnly.id)).productId).toBeNull();

      const unauthenticated = await anonymous.post(
        '/profile/customer-activation',
        consent,
      );
      expect(unauthenticated.status).toBe(401);

      const activation = await caller.post(
        '/profile/customer-activation',
        consent,
      );
      expect(activation.status).toBe(201);
      expect(activation.body.id).toBe(staffOnly.id);
      expect(activation.body.isBackoffice).toBe(true);

      const customer = await prisma.users.findUniqueOrThrow({
        where: { id: staffOnly.id },
        include: { product: true },
      });
      expect(customer.product).toMatchObject({ price: 0, type: 'USER' });
      expect(customer.termsAcceptedAt).toBeInstanceOf(Date);
      expect(customer.healthDataConsentAt).toBeInstanceOf(Date);
      expect(customer.isBackoffice).toBe(true);

      const again = await caller.post('/profile/customer-activation', consent);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('already_customer');
    });

    it('IT-019 an account left without plan after staff removal can still opt in', async () => {
      const removed = await createAccount('it019-removed', {
        productId: null,
        isBackoffice: false,
        backofficeTier: BackofficeTier.EQUIPE,
      });

      const activation = await (
        await asUser(removed)
      ).post('/profile/customer-activation', consent);

      expect(activation.status).toBe(201);
      expect((await reload(removed.id)).productId).not.toBeNull();
    });

    it('IT-021 GET /profile reports googleLinked and isBackoffice, before and after a link', async () => {
      const account = await createAccount('it021-account');
      const staff = await createStaff('it021-staff', BackofficeTier.EQUIPE);

      const before = await (await asUser(account)).get('/profile');
      expect(before.status).toBe(200);
      expect(before.body).toMatchObject({
        googleLinked: false,
        isBackoffice: false,
      });

      const link = await signInWithGoogle('it021-sub', account.email);
      expect(link.status).toBe(201);

      const after = await (await asUser(account)).get('/profile');
      expect(after.body).toMatchObject({
        googleLinked: true,
        isBackoffice: false,
      });
      expect(JSON.stringify(after.body)).not.toContain('it021-sub');

      const staffProfile = await (await asUser(staff)).get('/profile');
      expect(staffProfile.body).toMatchObject({
        googleLinked: false,
        isBackoffice: true,
      });
    });
  });

  describe('one account per email (US-001, US-012)', () => {
    it('IT-005 sign-up refuses an email that exists in another letter case', async () => {
      const stored = emailFor('it005').replace('integration', 'Integration');
      await createAccount('it005', { email: stored });

      const signup = await signUp(emailFor('it005'));

      expect(signup.status).toBe(400);
      await expect(countAccounts(stored)).resolves.toBe(1);
    });

    it('IT-005 the database itself refuses a second row for the same email', async () => {
      const account = await createAccount('it005b');
      // A staff row in another letter case: exactly the pair the old partial
      // indexes allowed. RUN_TAG stays as-is so cleanup would still find it.
      const variant = `${RUN_TAG}-IT005B@INTEGRATION.TEST`;

      await expect(
        prisma.users.create({
          data: {
            name: 'Duplicada',
            email: variant,
            password: passwordHash,
            isBackoffice: true,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(countAccounts(account.email)).resolves.toBe(1);
    });

    it('IT-013 an email with an underscore links only the identical address', async () => {
      // Created first on purpose: a wildcard match would find it before the
      // real one.
      const lookalike = await createAccount('axb');
      const real = await createAccount('a_b');

      const google = await signInWithGoogle('it013-sub', real.email);

      expect(google.status).toBe(201);
      expect(google.body.id).toBe(real.id);
      await expect(
        prisma.oAuthIdentity.count({ where: { userId: lookalike.id } }),
      ).resolves.toBe(0);

      // The lookup every student and patient registration goes through.
      const found = await app.get(UserRepository).findByEmail(real.email);
      expect(found?.id).toBe(real.id);
    });

    it('IT-020 two simultaneous first Google sign-ins leave exactly one account', async () => {
      const email = emailFor('it020');

      const [first, second] = await Promise.all([
        signInWithGoogle('it020-sub', email),
        signInWithGoogle('it020-sub', email),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      await expect(countAccounts(email)).resolves.toBe(1);
      await expect(
        prisma.oAuthIdentity.count({ where: { userId: first.body.id } }),
      ).resolves.toBe(1);
    });

    it('IT-022 a deleted account frees its email for a new sign-up', async () => {
      const account = await createAccount('it022');

      const removal = await (await asUser(account)).delete('/profile');
      expect(removal.status).toBe(204);

      const signup = await signUp(account.email);
      expect(signup.status).toBe(201);
      expect(signup.body.id).not.toBe(account.id);
      await expect(countAccounts(account.email)).resolves.toBe(1);
    });
  });

  describe('same account by either method (US-002, US-003)', () => {
    it('IT-006 password and Google sign-in enter the same account, and repeating adds nothing', async () => {
      const account = await createAccount('it006');

      const byPassword = await signInWithPassword(account.email);
      const byGoogle = await signInWithGoogle('it006-sub', account.email);

      expect(byPassword.status).toBe(201);
      expect(byGoogle.status).toBe(201);
      expect(byGoogle.body.id).toBe(account.id);
      expect(byPassword.body.id).toBe(account.id);

      const again = await signInWithGoogle('it006-sub', account.email);
      expect(again.body.id).toBe(account.id);
      await expect(
        prisma.oAuthIdentity.count({ where: { userId: account.id } }),
      ).resolves.toBe(1);
      await expect(countAccounts(account.email)).resolves.toBe(1);
    });

    it('IT-007 an account created by Google gets a password through recovery', async () => {
      const email = emailFor('it007');
      const created = await signInWithGoogle('it007-sub', email);
      expect(created.status).toBe(201);

      const unknown = await anonymous.post('/users/recoverpass', {
        email: emailFor('it007-nobody'),
      });
      const recovery = await anonymous.post('/users/recoverpass', { email });
      expect(recovery.status).toBe(201);
      expect(recovery.body).toEqual(unknown.body);

      const token = await lastRecoveryToken();
      const newPassword = {
        token,
        password: 'NovaSenha456',
        checkPassword: 'NovaSenha456',
      };
      const change = await anonymous.post('/users/newpassword', newPassword);
      expect(change.status).toBe(201);

      const signIn = await signInWithPassword(email, 'NovaSenha456');
      expect(signIn.status).toBe(201);
      expect(signIn.body.id).toBe(created.body.id);

      const reused = await anonymous.post('/users/newpassword', newPassword);
      expect(reused.status).toBe(400);
    });

    it('IT-008 Google activates a never-activated account and kills its old credentials', async () => {
      const account = await createAccount('it008', { active: false });
      await app.get(UserTokenService).issue(account.id, 'ACTIVATION' as never);

      const google = await signInWithGoogle('it008-sub', account.email);

      expect(google.status).toBe(201);
      expect(google.body.id).toBe(account.id);
      const activated = await reload(account.id);
      expect(activated.active).toBe(true);
      expect(activated.password).not.toBe(account.password);
      await expect(
        prisma.usersToken.count({ where: { userID: account.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.oAuthIdentity.count({ where: { userId: account.id } }),
      ).resolves.toBe(1);
      expect((await signInWithPassword(account.email)).status).toBe(401);
    });
  });

  describe('staff accounts and Google (US-004, US-005)', () => {
    it('IT-009 Google is refused for a staff account, active or pending, every time', async () => {
      const active = await createStaff('it009-active', BackofficeTier.ADMIN);
      const pending = await createStaff('it009-pending', BackofficeTier.EQUIPE);
      await prisma.users.update({
        where: { id: pending.id },
        data: { active: false },
      });
      const usersBefore = await prisma.users.count();

      for (const staff of [active, pending, active, pending]) {
        const refused = await signInWithGoogle(`sub-${staff.id}`, staff.email);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('google_link_required');
        expect(refused.body).not.toHaveProperty('accessToken');
      }

      await expect(prisma.users.count()).resolves.toBe(usersBefore);
      expect((await reload(active.id)).active).toBe(true);
      expect((await reload(pending.id)).active).toBe(false);
      await expect(
        prisma.oAuthIdentity.count({
          where: { userId: { in: [active.id, pending.id] } },
        }),
      ).resolves.toBe(0);
    });

    it('IT-010 a staff member connects Google with the password and then signs in with Google', async () => {
      const staff = await createStaff('it010', BackofficeTier.ADMIN);

      const intent = await linkIntent(staff, PASSWORD);
      expect(intent.status).toBe(201);

      const link = await linkGoogle(staff, intent.body.intent as string, {
        sub: 'it010-sub',
        email: staff.email,
      });
      expect(link.status).toBe(201);
      expect(link.body.id).toBe(staff.id);
      expect(link.body.accessToken).toEqual(expect.any(String));

      const google = await signInWithGoogle('it010-sub', staff.email);
      expect(google.status).toBe(201);
      expect(google.body.id).toBe(staff.id);
      await expect(countAccounts(staff.email)).resolves.toBe(1);
    });

    it('IT-011 linking refuses a wrong password, another email, a taken identity and a foreign or expired intent', async () => {
      const staff = await createStaff('it011-staff', BackofficeTier.EQUIPE);
      const ordinary = await createAccount('it011-ordinary');
      const other = await createAccount('it011-other');

      const wrong = await linkIntent(staff, 'SenhaErrada999');
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('invalid_password');
      expect((await linkIntent(staff)).status).toBe(401);

      const granted = await linkIntent(ordinary);
      expect(granted.status).toBe(201);
      const intent = granted.body.intent as string;

      const mismatch = await linkGoogle(ordinary, intent, {
        sub: 'it011-a',
        email: other.email,
      });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.code).toBe('google_email_mismatch');

      await signInWithGoogle('it011-taken', other.email);
      const taken = await linkGoogle(ordinary, intent, {
        sub: 'it011-taken',
        email: ordinary.email,
      });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('google_identity_in_use');

      const foreign = await linkGoogle(staff, intent, {
        sub: 'it011-b',
        email: staff.email,
      });
      expect(foreign.status).toBe(401);
      expect(foreign.body.code).toBe('invalid_intent');

      const expired = await jwtService.signAsync(
        { purpose: 'google_link', id: ordinary.id },
        { expiresIn: -10 },
      );
      const late = await linkGoogle(ordinary, expired, {
        sub: 'it011-c',
        email: ordinary.email,
      });
      expect(late.status).toBe(401);
      expect(late.body.code).toBe('invalid_intent');

      await expect(
        prisma.oAuthIdentity.count({
          where: { userId: { in: [staff.id, ordinary.id] } },
        }),
      ).resolves.toBe(0);
    });

    it('IT-011 linking needs a session and never accepts an account id from the client', async () => {
      const ordinary = await createAccount('it011b-ordinary');
      const victim = await createStaff('it011b-victim', BackofficeTier.ADMIN);
      const intent = (await linkIntent(ordinary)).body.intent as string;
      googleTokens.set('google-it011b', {
        sub: 'it011b-sub',
        email: victim.email,
      });

      const anonymousAttempt = await anonymous.post('/auth/google/link', {
        idToken: 'google-it011b',
        intent,
      });
      expect(anonymousAttempt.status).toBe(401);

      const crafted = await (
        await asUser(ordinary)
      ).post('/auth/google/link', {
        idToken: 'google-it011b',
        intent,
        userId: victim.id,
      });
      expect(crafted.status).toBe(400);

      await expect(
        prisma.oAuthIdentity.count({ where: { userId: victim.id } }),
      ).resolves.toBe(0);
    });
  });

  describe('receptionist and Google (US-010)', () => {
    it('IT-012 a receptionist email is refused by Google, creates nothing, and still signs in with the password', async () => {
      const academia = await prisma.academia.create({
        data: { name: `${RUN_TAG} Academia` },
      });
      createdAcademiaIds.push(academia.id);
      const receptionist = await prisma.academiaStaffMember.create({
        data: {
          academiaId: academia.id,
          name: 'Recepção',
          email: emailFor('it012-recepcao'),
          passwordHash,
        },
      });

      const google = await signInWithGoogle('it012-sub', receptionist.email);

      expect(google.status).toBe(403);
      expect(google.body.code).toBe('google_receptionist_email');
      await expect(countAccounts(receptionist.email)).resolves.toBe(0);

      const signIn = await signInWithPassword(receptionist.email);
      expect(signIn.status).toBe(201);
      expect(signIn.body.id).toBe(receptionist.id);
    });
  });
});
