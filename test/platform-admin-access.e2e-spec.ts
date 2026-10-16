/**
 * Integration tests for PRD `platform-admin-access` (task_02, task_03,
 * task_04, backend).
 *
 * Runs the real BackofficeStaffController, BackofficeDirectoryController,
 * ViewAsSessionController, AuditLogController, a minimal real
 * customer-facing ProfileController (as the "ver como" read-target), their
 * services, the repositories, AuthGuard, BackofficeGuard, AdminTierGuard,
 * the global ViewAsWriteBlockGuard and the app's global ValidationPipe
 * against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AuditLogController } from '@/backoffice/auditLog/auditLog.controller';
import { AuditLogService } from '@/backoffice/auditLog/auditLog.service';
import { BackofficeDirectoryController } from '@/backoffice/directory/backofficeDirectory.controller';
import { BackofficeDirectoryService } from '@/backoffice/directory/backofficeDirectory.service';
import { BackofficeStaffController } from '@/backoffice/staff/backofficeStaff.controller';
import { BackofficeStaffService } from '@/backoffice/staff/backofficeStaff.service';
import { ViewAsExpirySweepCron } from '@/backoffice/viewAs/viewAsExpirySweep.cron';
import { ViewAsRetentionPurgeCron } from '@/backoffice/viewAs/viewAsRetentionPurge.cron';
import { ViewAsSessionController } from '@/backoffice/viewAs/viewAsSession.controller';
import { ViewAsSessionService } from '@/backoffice/viewAs/viewAsSession.service';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { ViewAsWriteBlockGuard } from '@/common/guards/viewAsWriteBlock.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { ProfileController } from '@/users/profile/profile.controller';
import { ProfileService } from '@/users/profile/profile.service';
import { UserTokenService } from '@/users/token/userToken.service';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Academia,
  BackofficeTier,
  ProductType,
  Users,
  ViewAsTargetKind,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `platform-admin-access-${Date.now()}`;

describe('Platform admin access — staff management integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  const jwtSecret = 'platform-admin-access-integration-jwt-secret';
  const createdUserIds: string[] = [];
  const createdAcademiaIds: string[] = [];
  const sendEmailPassword = jest.fn();

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
      controllers: [
        BackofficeStaffController,
        BackofficeDirectoryController,
        ViewAsSessionController,
        AuditLogController,
        ProfileController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        UserTokenRepository,
        UserTokenService,
        PasswordHash,
        BackofficeViewAsSessionRepository,
        BackofficeStaffService,
        AcademiaStaffMemberRepository,
        BackofficeDirectoryService,
        ViewAsSessionService,
        AuditLogService,
        ViewAsExpirySweepCron,
        ViewAsRetentionPurgeCron,
        ClientsRepository,
        ProgressPhotosRepository,
        UploadService,
        ProfileService,
        { provide: MailService, useValue: { sendEmailPassword } },
        AuthGuard,
        BackofficeGuard,
        AdminTierGuard,
        { provide: APP_GUARD, useClass: ViewAsWriteBlockGuard },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await prisma.backofficeViewAsSession.deleteMany({
      where: { staffUserId: { in: createdUserIds } },
    });
    await prisma.usersToken.deleteMany({
      where: { userID: { in: createdUserIds } },
    });
    await prisma.academiaStaffMember.deleteMany({
      where: { academiaId: { in: createdAcademiaIds } },
    });
    await prisma.academia.deleteMany({
      where: { id: { in: createdAcademiaIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
    if (groupId) {
      await prisma.product.deleteMany({ where: { groupId } });
      await prisma.productGroup.deleteMany({ where: { id: groupId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  async function createAdmin(label: string): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Admin ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        isBackoffice: true,
        backofficeTier: BackofficeTier.ADMIN,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

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
      patch: (url: string, body: object = {}) =>
        request(server).patch(url).set('Authorization', auth).send(body),
      delete: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  function asToken(token: string) {
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
    };
  }

  async function createStaff(
    label: string,
    tier: BackofficeTier,
  ): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Staff ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        isBackoffice: true,
        backofficeTier: tier,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createTargetUser(label: string): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Target ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  it('IT-001 invite -> activate -> login -> appears in GET /backoffice/staff', async () => {
    const admin = await asUser(await createAdmin('it001-admin'));

    const invite = await admin.post('/backoffice/staff', {
      email: `${RUN_TAG}-invited@integration.test`,
      tier: BackofficeTier.EQUIPE,
    });
    expect(invite.status).toBe(201);
    expect(sendEmailPassword).toHaveBeenCalled();

    const invited = await prisma.users.findFirst({
      where: {
        email: `${RUN_TAG}-invited@integration.test`,
        isBackoffice: true,
      },
    });
    expect(invited).not.toBeNull();
    createdUserIds.push(invited!.id);

    // The real invite flow embeds the raw activation token in the email
    // link; the mocked MailService lets the test recover it the same way a
    // real inbox would, instead of minting a token through a side channel.
    const activationUrl = sendEmailPassword.mock.calls.at(-1)![4] as string;
    const rawToken = new URL(activationUrl).searchParams.get('token')!;

    const activation = await request(app.getHttpServer())
      .post('/backoffice/staff/activate')
      .send({ token: rawToken, password: 'NovaSenha123' });
    expect(activation.status).toBe(201);

    const loggedIn = await asUser({ ...invited!, active: true });
    const list = await loggedIn.get('/backoffice/staff');
    expect(list.status).toBe(200);
    expect(
      list.body.some(
        (item: { email: string }) => item.email === invited!.email,
      ),
    ).toBe(true);
  });

  it('IT-006 with exactly one ADMIN remaining, demote-self and remove-the-last-admin are rejected through the real endpoints', async () => {
    const soleAdmin = await createAdmin('it006-sole');
    const caller = await asUser(soleAdmin);

    const demote = await caller.patch(`/backoffice/staff/${soleAdmin.id}`, {
      tier: BackofficeTier.EQUIPE,
    });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('last_admin_required');

    const remove = await caller.delete(`/backoffice/staff/${soleAdmin.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.code).toBe('last_admin_required');

    const stillAdmin = await prisma.users.findUnique({
      where: { id: soleAdmin.id },
    });
    expect(stillAdmin?.backofficeTier).toBe(BackofficeTier.ADMIN);
    expect(stillAdmin?.isBackoffice).toBe(true);
  });

  it('IT-007 a type-filtered, searched, paginated directory search merges Users and AcademiaStaffMember correctly, with no cross-academia field confusion', async () => {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            { name: `${RUN_TAG} user`, price: 0, type: ProductType.USER },
            {
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
            {
              name: `${RUN_TAG} educator`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} academia`,
              price: 10,
              type: ProductType.ACADEMIA,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const productIdFor = (type: ProductType) =>
      group.products.find((p) => p.type === type)!.id;

    const academiaX: Academia = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia X` },
    });
    const academiaY: Academia = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia Y` },
    });
    createdAcademiaIds.push(academiaX.id, academiaY.id);

    const plainUser = await prisma.users.create({
      data: {
        name: `${RUN_TAG} Plain User`,
        email: `${RUN_TAG}-plain@integration.test`,
        password: 'unused',
        active: true,
        productId: productIdFor(ProductType.USER),
      },
    });
    const nutri = await prisma.users.create({
      data: {
        name: `${RUN_TAG} Nutri`,
        email: `${RUN_TAG}-nutri@integration.test`,
        password: 'unused',
        active: true,
        productId: productIdFor(ProductType.NUTRITIONIST),
      },
    });
    const ownerX = await prisma.users.create({
      data: {
        name: `${RUN_TAG} Owner X`,
        email: `${RUN_TAG}-owner-x@integration.test`,
        password: 'unused',
        active: true,
        productId: productIdFor(ProductType.ACADEMIA),
        academiaId: academiaX.id,
      },
    });
    const ownerY = await prisma.users.create({
      data: {
        name: `${RUN_TAG} Owner Y`,
        email: `${RUN_TAG}-owner-y@integration.test`,
        password: 'unused',
        active: true,
        productId: productIdFor(ProductType.ACADEMIA),
        academiaId: academiaY.id,
      },
    });
    createdUserIds.push(plainUser.id, nutri.id, ownerX.id, ownerY.id);

    const receptionistX = await prisma.academiaStaffMember.create({
      data: {
        academiaId: academiaX.id,
        name: `${RUN_TAG} Recepcao X`,
        email: `${RUN_TAG}-recepcao-x@integration.test`,
      },
    });
    // Academia Y deliberately has no receptionist yet (UT-003 at integration
    // scale): only its owner should ever appear for it.

    const caller = await asUser(await createAdmin('it007-admin'));

    const everything = await caller.get(
      `/backoffice/accounts?search=${RUN_TAG}`,
    );
    expect(everything.status).toBe(200);
    const byId = Object.fromEntries(
      (everything.body.items as { id: string; kind: string }[]).map((i) => [
        i.id,
        i.kind,
      ]),
    );
    expect(byId[plainUser.id]).toBe('USER');
    expect(byId[nutri.id]).toBe('NUTRITIONIST');
    expect(byId[ownerX.id]).toBe('ACADEMIA_OWNER');
    expect(byId[ownerY.id]).toBe('ACADEMIA_OWNER');
    expect(byId[receptionistX.id]).toBe('ACADEMIA_RECEPTIONIST');

    const academiaOnly = await caller.get(
      `/backoffice/accounts?search=${RUN_TAG}&type=ACADEMIA`,
    );
    const academiaIds = (academiaOnly.body.items as { id: string }[]).map(
      (i) => i.id,
    );
    expect(academiaIds).toEqual(
      expect.arrayContaining([ownerX.id, ownerY.id, receptionistX.id]),
    );
    expect(academiaIds).not.toContain(plainUser.id);
    expect(academiaIds).not.toContain(nutri.id);

    const receptionistRow = (
      academiaOnly.body.items as { id: string; name: string; email: string }[]
    ).find((i) => i.id === receptionistX.id)!;
    expect(receptionistRow.name).toBe(receptionistX.name);
    expect(receptionistRow.email).toBe(receptionistX.email);

    const noMatch = await caller.get(
      `/backoffice/accounts?search=${RUN_TAG}-nothing-matches-this`,
    );
    expect(noMatch.body).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  });

  it('IT-002 a "ver como" session reads the real target, blocks every mutation, and the end-session endpoint itself is exempt', async () => {
    const admin = await asUser(await createAdmin('it002-admin'));
    const target = await createTargetUser('it002-target');

    const start = await admin.post('/backoffice/view-as-sessions', {
      targetKind: ViewAsTargetKind.USER,
      targetId: target.id,
      reason: 'Investigando chamado de suporte',
    });
    expect(start.status).toBe(201);
    const viewAs = asToken(start.body.token as string);

    const read = await viewAs.get('/profile');
    expect(read.status).toBe(200);
    expect(read.body.name).toBe(target.name);
    expect(read.body.id).toBe(target.id);

    const write = await viewAs.post('/profile', { name: 'Nome Alterado' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('view_as_write_blocked');

    const unchanged = await prisma.users.findUnique({
      where: { id: target.id },
    });
    expect(unchanged?.name).toBe(target.name);

    const end = await viewAs.post(
      `/backoffice/view-as-sessions/${start.body.sessionId as string}/end`,
    );
    expect(end.status).toBe(200);

    const closedSession = await prisma.backofficeViewAsSession.findUnique({
      where: { id: start.body.sessionId as string },
    });
    expect(closedSession?.endedAt).not.toBeNull();
  });

  it('IT-003 removing a staff member mid-session invalidates their open "ver como" session on the very next request', async () => {
    const admin = await asUser(await createAdmin('it003-admin'));
    const equipeStaff = await createStaff(
      'it003-equipe',
      BackofficeTier.EQUIPE,
    );
    const target = await createTargetUser('it003-target');
    const equipeCaller = await asUser(equipeStaff);

    const start = await equipeCaller.post('/backoffice/view-as-sessions', {
      targetKind: ViewAsTargetKind.USER,
      targetId: target.id,
      reason: 'Acompanhando chamado',
    });
    expect(start.status).toBe(201);
    const viewAs = asToken(start.body.token as string);

    const removal = await admin.delete(`/backoffice/staff/${equipeStaff.id}`);
    expect(removal.status).toBe(200);

    const readAfterRemoval = await viewAs.get('/profile');
    expect(readAfterRemoval.status).toBe(403);
  });

  it('IT-004 the expiry sweep sets endedAt to exactly each row\'s own expiresAt, never a shared "now"', async () => {
    const staff = await createStaff('it004-staff', BackofficeTier.EQUIPE);
    const target = await createTargetUser('it004-target');

    const expiresAt = new Date(Date.now() - 10 * 60 * 1000);
    const session = await prisma.backofficeViewAsSession.create({
      data: {
        staffUserId: staff.id,
        targetKind: ViewAsTargetKind.USER,
        targetUserId: target.id,
        reason: 'Sessão abandonada',
        expiresAt,
      },
    });

    const cron = moduleRefCron();
    await cron.closeExpiredSessions();

    const closed = await prisma.backofficeViewAsSession.findUnique({
      where: { id: session.id },
    });
    expect(closed?.endedAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  it('IT-005 the retention purge deletes only sessions older than the 2-year cutoff', async () => {
    const staff = await createStaff('it005-staff', BackofficeTier.EQUIPE);
    const target = await createTargetUser('it005-target');

    const old = await prisma.backofficeViewAsSession.create({
      data: {
        staffUserId: staff.id,
        targetKind: ViewAsTargetKind.USER,
        targetUserId: target.id,
        reason: 'Sessão antiga',
        expiresAt: new Date('2022-01-01T00:00:30.000Z'),
        startedAt: new Date('2022-01-01T00:00:00.000Z'),
        endedAt: new Date('2022-01-01T00:30:00.000Z'),
      },
    });
    const recent = await prisma.backofficeViewAsSession.create({
      data: {
        staffUserId: staff.id,
        targetKind: ViewAsTargetKind.USER,
        targetUserId: target.id,
        reason: 'Sessão recente',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const cron = moduleRefPurgeCron();
    await cron.purgeOldSessions();

    const [oldRow, recentRow] = await Promise.all([
      prisma.backofficeViewAsSession.findUnique({ where: { id: old.id } }),
      prisma.backofficeViewAsSession.findUnique({ where: { id: recent.id } }),
    ]);
    expect(oldRow).toBeNull();
    expect(recentRow).not.toBeNull();
  });

  function moduleRefCron(): ViewAsExpirySweepCron {
    return app.get(ViewAsExpirySweepCron);
  }

  function moduleRefPurgeCron(): ViewAsRetentionPurgeCron {
    return app.get(ViewAsRetentionPurgeCron);
  }
});
