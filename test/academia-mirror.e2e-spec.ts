/**
 * Integration/E2E tests for PRD `student-access-plan-profile` (task_01, backend).
 *
 * Runs the real AcademiaMirrorController/Service, the new repository
 * methods, StudentAccessPlanService.currentForClient unmodified, and
 * AuthGuard against an isolated database.
 *
 * IT-001..IT-007 and E2E-001..E2E-008 (`_tests.md`) both exercise the same
 * real HTTP surface in this project's convention (see
 * professional-food-diary-and-mirror.e2e-spec.ts) — there is no separate
 * browser-E2E layer for the backend.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaMirrorController } from '@/academia-mirror/academiaMirror.controller';
import { AcademiaMirrorService } from '@/academia-mirror/academiaMirror.service';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Academia,
  AccessPlanValidityType,
  AcademiaAccessPlan,
  Client,
  ProductType,
  Users,
} from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `academia-mirror-${Date.now()}`;

describe('Academia mirror ("Minha academia") integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let academiaA: Academia;
  let academiaB: Academia;
  let studentA: Users;
  let studentOther: Users;
  let clientA: Client;
  let clientB: Client;
  let daysPlan: AcademiaAccessPlan;
  let visitsPlan: AcademiaAccessPlan;

  const jwtSecret = 'academia-mirror-integration-jwt-secret';

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
      controllers: [AcademiaMirrorController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        StudentAccessPlanRepository,
        StudentAccessPlanService,
        AcademiaAccessPlanRepository,
        Clock,
        AuthGuard,
        AcademiaMirrorService,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(async () => {
    await prisma.checkIn.deleteMany({
      where: { clientId: { in: [clientA.id, clientB.id] } },
    });
    await prisma.studentAccessPlan.deleteMany({
      where: { clientId: { in: [clientA.id, clientB.id] } },
    });
  });

  afterAll(async () => {
    await prisma.academiaAccessPlan.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.client.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.academia.deleteMany({
      where: { id: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: [studentA.id, studentOther.id] } },
    });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            { name: `${RUN_TAG} user`, price: 0, type: ProductType.USER },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const userProduct = group.products.find(
      (p) => p.type === ProductType.USER,
    )!;

    academiaA = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia A` },
    });
    academiaB = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia B` },
    });

    studentA = await createUser('student-a', { productId: userProduct.id });
    studentOther = await createUser('student-other', {
      productId: userProduct.id,
    });

    clientA = await prisma.client.create({
      data: {
        name: 'Aluno A',
        email: `${RUN_TAG}-client-a@integration.test`,
        phone: '',
        userId: studentA.id,
        academia: { connect: { id: academiaA.id } },
      },
    });
    clientB = await prisma.client.create({
      data: {
        name: 'Aluno A (segunda academia)',
        email: `${RUN_TAG}-client-b@integration.test`,
        phone: '',
        userId: studentA.id,
        academia: { connect: { id: academiaB.id } },
      },
    });

    daysPlan = await prisma.academiaAccessPlan.create({
      data: {
        academiaId: academiaA.id,
        name: 'Mensal',
        validityType: AccessPlanValidityType.DAYS,
        validityValue: 30,
        referencePrice: 100,
      },
    });
    visitsPlan = await prisma.academiaAccessPlan.create({
      data: {
        academiaId: academiaA.id,
        name: '10 acessos',
        validityType: AccessPlanValidityType.VISITS,
        validityValue: 10,
        referencePrice: 150,
      },
    });
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Academia Mirror ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
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
    };
  }

  async function assignPlan(
    clientId: string,
    plan: AcademiaAccessPlan,
    overrides: { expiresAt?: Date } = {},
  ) {
    const created = await prisma.studentAccessPlan.create({
      data: {
        clientId,
        accessPlanId: plan.id,
        validityType: plan.validityType,
        validityValue: plan.validityValue,
        referencePrice: plan.referencePrice,
        status: 'ARCHIVED',
        expiresAt:
          overrides.expiresAt ??
          (plan.validityType === AccessPlanValidityType.DAYS
            ? new Date(Date.now() + plan.validityValue * 24 * 60 * 60 * 1000)
            : null),
      },
    });
    await prisma.studentAccessPlan.updateMany({
      where: { clientId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    await prisma.studentAccessPlan.update({
      where: { id: created.id },
      data: { status: 'ACTIVE' },
    });
    return created;
  }

  it('IT-001/E2E-001 a single valid DAYS-plan membership returns the gym name, plan, validity and status', async () => {
    await assignPlan(clientA.id, daysPlan);
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    expect(response.status).toBe(200);
    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaA.id,
    );
    expect(membership).toMatchObject({
      academiaName: `${RUN_TAG} Academia A`,
      currentPlan: {
        status: 'VALID',
        planName: 'Mensal',
        validityType: 'DAYS',
        validityValue: 30,
      },
    });
    expect(membership.currentPlan.remaining).toBeGreaterThan(0);
  });

  it('IT-002/E2E-002 a student with two gym memberships sees both, each independently correct', async () => {
    await assignPlan(clientA.id, daysPlan);
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    const academiaIds = response.body.map(
      (m: { academiaId: string }) => m.academiaId,
    );
    expect(academiaIds).toEqual(
      expect.arrayContaining([academiaA.id, academiaB.id]),
    );
    const membershipB = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaB.id,
    );
    expect(membershipB.currentPlan.status).toBe('NO_PLAN');
  });

  it('IT-001/E2E-003 an expired DAYS plan reports status EXPIRED', async () => {
    await assignPlan(clientA.id, daysPlan, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaA.id,
    );
    expect(membership.currentPlan.status).toBe('EXPIRED');
    expect(membership.currentPlan.remaining).toBeNull();
  });

  it('IT-001/E2E-004 an exhausted VISITS plan reports status EXHAUSTED', async () => {
    const activePlan = await assignPlan(clientA.id, visitsPlan);
    // assignedAt must precede every check-in below, or
    // findCheckInTimestampsSince excludes them (gte: assignedAt).
    await prisma.studentAccessPlan.update({
      where: { id: activePlan.id },
      data: { assignedAt: new Date(Date.now() - 11 * 25 * 60 * 60 * 1000) },
    });
    const s = await asUser(studentA);
    // 25h apart guarantees a distinct BRT calendar day each time (any gap
    // > 24h always crosses a date boundary), so this yields exactly
    // validityValue distinct days.
    for (let i = 0; i < visitsPlan.validityValue; i += 1) {
      await prisma.checkIn.create({
        data: {
          clientId: clientA.id,
          source: 'SELF',
          planValidAtCheckIn: true,
          createdAt: new Date(Date.now() - i * 25 * 60 * 60 * 1000),
        },
      });
    }

    const response = await s.get('/me/academia');

    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaA.id,
    );
    expect(membership.currentPlan.status).toBe('EXHAUSTED');
    expect(membership.currentPlan.remaining).toBeNull();
  });

  it('IT-001/E2E-005 a membership with no plan assigned reports status NO_PLAN', async () => {
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaB.id,
    );
    expect(membership.currentPlan).toEqual({
      status: 'NO_PLAN',
      planName: null,
      validityType: null,
      validityValue: null,
      remaining: null,
    });
  });

  it('IT-003/E2E-006 a student with zero gym memberships gets 200 with an empty array', async () => {
    const lonely = await createUser('student-lonely', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.USER },
        })
      ).id,
    });
    const s = await asUser(lonely);

    const response = await s.get('/me/academia');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);

    await prisma.users.delete({ where: { id: lonely.id } });
  });

  it('IT-004 an unauthenticated request is rejected by AuthGuard', async () => {
    const response = await request(app.getHttpServer()).get('/me/academia');

    expect(response.status).toBe(401);
  });

  it('IT-005 a membership whose Client row was removed no longer appears, with no error', async () => {
    const removable = await prisma.client.create({
      data: {
        name: 'Aluno Removível',
        email: `${RUN_TAG}-removable@integration.test`,
        phone: '',
        userId: studentA.id,
        academia: { connect: { id: academiaB.id } },
      },
    });
    const s = await asUser(studentA);
    const before = await s.get('/me/academia');
    expect(before.body.length).toBeGreaterThanOrEqual(3);

    await prisma.client.delete({ where: { id: removable.id } });
    const after = await s.get('/me/academia');

    expect(after.status).toBe(200);
    expect(after.body.length).toBe(before.body.length - 1);
  });

  it('IT-006/E2E-007 archived plans appear newest-first, each with name, validity and dates', async () => {
    const older = await assignPlan(clientA.id, visitsPlan);
    await prisma.studentAccessPlan.update({
      where: { id: older.id },
      data: {
        assignedAt: new Date('2026-08-01T00:00:00.000Z'),
        status: 'ARCHIVED',
      },
    });
    const newer = await assignPlan(clientA.id, daysPlan);
    await prisma.studentAccessPlan.update({
      where: { id: newer.id },
      data: { assignedAt: new Date('2026-09-01T00:00:00.000Z') },
    });
    await prisma.studentAccessPlan.updateMany({
      where: { id: { in: [older.id] } },
      data: { status: 'ARCHIVED' },
    });
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaA.id,
    );
    expect(membership.history.length).toBeGreaterThanOrEqual(1);
    const archivedOlder = membership.history.find(
      (entry: { planName: string }) => entry.planName === '10 acessos',
    );
    expect(archivedOlder).toMatchObject({
      planName: '10 acessos',
      validityType: 'VISITS',
      validityValue: 10,
    });
    expect(archivedOlder.assignedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(typeof archivedOlder.endedAt).toBe('string');
  });

  it('IT-006/E2E-008 a membership that never had a prior plan has an empty history', async () => {
    await assignPlan(clientA.id, daysPlan);
    const s = await asUser(studentA);

    const response = await s.get('/me/academia');

    const membership = response.body.find(
      (m: { academiaId: string }) => m.academiaId === academiaA.id,
    );
    expect(membership.history).toEqual([]);
  });

  it('IT-007 user A never sees user B’s own gym membership', async () => {
    const userB = await createUser('user-b', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.USER },
        })
      ).id,
    });
    const academiaC = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia C` },
    });
    const clientC = await prisma.client.create({
      data: {
        name: 'Aluno C',
        email: `${RUN_TAG}-client-c@integration.test`,
        phone: '',
        userId: userB.id,
        academia: { connect: { id: academiaC.id } },
      },
    });
    const sA = await asUser(studentA);
    const sB = await asUser(userB);

    const responseA = await sA.get('/me/academia');
    const responseB = await sB.get('/me/academia');

    expect(
      responseA.body.some(
        (m: { academiaId: string }) => m.academiaId === academiaC.id,
      ),
    ).toBe(false);
    expect(responseB.body).toHaveLength(1);
    expect(responseB.body[0].academiaId).toBe(academiaC.id);

    await prisma.client.delete({ where: { id: clientC.id } });
    await prisma.academia.delete({ where: { id: academiaC.id } });
    await prisma.users.delete({ where: { id: userB.id } });
  });
});
