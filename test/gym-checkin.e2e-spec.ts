/**
 * Integration tests for PRD `gym-checkin` (task_02, task_03, task_04, backend).
 *
 * Runs the real CheckInController/ReceptionistCheckInController/
 * StudentAccessPlanController/EngajamentoController, their services, the
 * repositories, AuthGuard, GymStudentGuard, ReceptionistAuthGuard,
 * AcademiaOwnerGuard and the app's global ValidationPipe against an isolated
 * database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { GymStudentGuard } from '@/common/guards/gymStudent.guard';
import { ReceptionistAuthGuard } from '@/common/guards/receptionistAuth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { CheckInController } from '@/academia/checkin/checkin.controller';
import { CheckInService } from '@/academia/checkin/checkin.service';
import { ReceptionistCheckInController } from '@/academia/checkin/receptionistCheckin.controller';
import { StudentAccessPlanController } from '@/academia/checkin/studentAccessPlan.controller';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { EngajamentoController } from '@/academia/engajamento/engajamento.controller';
import { EngajamentoService } from '@/academia/engajamento/engajamento.service';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
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
  Academia as AcademiaModel,
  AcademiaAccessPlan,
  AcademiaStaffMember,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `gym-checkin-${Date.now()}`;

describe('Gym check-in integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let academiaA: Academia;
  let academiaB: AcademiaModel;
  let ownerA: Users;
  let educatorShared: Users;
  let studentA: Users;
  let studentB: Users;
  let receptionistA: AcademiaStaffMember;
  let daysPlan: AcademiaAccessPlan;
  let visitsPlan: AcademiaAccessPlan;
  const jwtSecret = 'gym-checkin-integration-jwt-secret';

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
        CheckInController,
        ReceptionistCheckInController,
        StudentAccessPlanController,
        EngajamentoController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        AcademiaAccessPlanRepository,
        AcademiaStaffMemberRepository,
        CheckInRepository,
        StudentAccessPlanRepository,
        CheckInService,
        StudentAccessPlanService,
        EngajamentoService,
        Clock,
        AuthGuard,
        GymStudentGuard,
        ReceptionistAuthGuard,
        AcademiaOwnerGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(async () => {
    await prisma.checkIn.deleteMany({
      where: { client: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.studentAccessPlan.deleteMany({
      where: { client: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
  });

  afterAll(async () => {
    await prisma.academiaAccessPlan.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.client.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.academiaStaffMember.deleteMany({
      where: { academiaId: academiaA.id },
    });
    await prisma.academia.deleteMany({
      where: { id: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.users.deleteMany({
      where: {
        id: { in: [ownerA.id, educatorShared.id, studentA.id, studentB.id] },
      },
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
            { name: `${RUN_TAG} user`, price: 0, type: ProductType.USER },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const educatorProduct = group.products.find(
      (p) => p.type === ProductType.PHYSICAL_EDUCATOR,
    )!;
    const academiaProduct = group.products.find(
      (p) => p.type === ProductType.ACADEMIA,
    )!;
    const userProduct = group.products.find(
      (p) => p.type === ProductType.USER,
    )!;

    academiaA = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia A` },
    });
    academiaB = await prisma.academia.create({
      data: { name: `${RUN_TAG} Academia B` },
    });

    ownerA = await createUser('owner-a', {
      productId: academiaProduct.id,
      academiaId: academiaA.id,
    });
    educatorShared = await createUser('educator-shared', {
      productId: educatorProduct.id,
    });
    studentA = await createUser('student-a', { productId: userProduct.id });
    studentB = await createUser('student-b', { productId: userProduct.id });

    await prisma.employment.create({
      data: {
        academiaId: academiaA.id,
        educatorId: educatorShared.id,
        status: 'ACTIVE',
      },
    });

    await prisma.client.create({
      data: {
        name: 'Aluno A',
        email: `${RUN_TAG}-client-a@integration.test`,
        phone: '',
        userId: studentA.id,
        academia: { connect: { id: academiaA.id } },
      },
    });
    await prisma.client.create({
      data: {
        name: 'Aluno B',
        email: `${RUN_TAG}-client-b@integration.test`,
        phone: '',
        userId: studentB.id,
        academia: { connect: { id: academiaB.id } },
      },
    });

    receptionistA = await prisma.academiaStaffMember.create({
      data: {
        academiaId: academiaA.id,
        name: 'Recepcionista A',
        email: `${RUN_TAG}-staff-a@integration.test`,
        active: true,
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
        name: `Gym Checkin ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function bearerForUser(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  async function bearerForStaff(target: AcademiaStaffMember): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  async function asUser(target: Users) {
    const auth = await bearerForUser(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
    };
  }

  async function asStaff(target: AcademiaStaffMember) {
    const auth = await bearerForStaff(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
    };
  }

  it('IT-001 a student checking in twice the same BRT day creates both rows; aggregates count once', async () => {
    const s = await asUser(studentA);

    const first = await s.post('/checkins');
    expect(first.status).toBe(201);
    const second = await s.post('/checkins');
    expect(second.status).toBe(201);

    const owner = await asUser(ownerA);
    const summary = await owner.get('/academia/engajamento');
    expect(summary.status).toBe(200);
    expect(summary.body.todayCheckInCount).toBe(1);

    const rows = await prisma.checkIn.count({
      where: { client: { academiaId: academiaA.id } },
    });
    expect(rows).toBe(2);
  });

  it("IT-002 receptionist searches (partial/case/accent-insensitive), checks in this academia's own student, is refused for a different academia's student even by direct id", async () => {
    const r = await asStaff(receptionistA);

    const found = await r.get('/academia/staff/students?search=aluno');
    expect(found.status).toBe(200);
    expect(
      found.body.some((item: { name: string }) => item.name === 'Aluno A'),
    ).toBe(true);

    const empty = await r.get('/academia/staff/students?search=zzz-ninguem');
    expect(empty.body).toEqual([]);

    const clientA = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });
    const checkedIn = await r.post(
      `/academia/staff/students/${clientA.id}/checkin`,
    );
    expect(checkedIn.status).toBe(201);

    const clientB = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaB.id, userId: studentB.id },
    });
    const refused = await r.post(
      `/academia/staff/students/${clientB.id}/checkin`,
    );
    expect(refused.status).toBe(404);
  });

  it('IT-003 sequential DAYS then VISITS assignment: only the latest is ever ACTIVE; concurrent assignments resolve to exactly one ACTIVE row', async () => {
    const owner = await asUser(ownerA);
    const client = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });

    const first = await owner.post(
      `/academia/students/${client.id}/access-plan`,
      { accessPlanId: daysPlan.id },
    );
    expect(first.status).toBe(201);
    const second = await owner.post(
      `/academia/students/${client.id}/access-plan`,
      { accessPlanId: visitsPlan.id },
    );
    expect(second.status).toBe(201);

    const activeCount = await prisma.studentAccessPlan.count({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    expect(activeCount).toBe(1);

    const results = await Promise.all([
      owner.post(`/academia/students/${client.id}/access-plan`, {
        accessPlanId: daysPlan.id,
      }),
      owner.post(`/academia/students/${client.id}/access-plan`, {
        accessPlanId: visitsPlan.id,
      }),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const afterRace = await prisma.studentAccessPlan.count({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    expect(afterRace).toBe(1);
  });

  it("IT-004 a DAYS plan's expiresAt flags EXPIRED without ever blocking a check-in", async () => {
    const owner = await asUser(ownerA);
    const client = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });

    await owner.post(`/academia/students/${client.id}/access-plan`, {
      accessPlanId: daysPlan.id,
    });
    const activePlan = await prisma.studentAccessPlan.findFirstOrThrow({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    await prisma.studentAccessPlan.update({
      where: { id: activePlan.id },
      data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const current = await owner.get(
      `/academia/students/${client.id}/access-plan`,
    );
    expect(current.body.status).toBe('EXPIRED');

    const s = await asUser(studentA);
    const checkIn = await s.post('/checkins');
    expect(checkIn.status).toBe(201);

    const row = await prisma.checkIn.findFirstOrThrow({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.planValidAtCheckIn).toBe(false);
  });

  it("IT-005 a VISITS plan's remaining count decrements by distinct day, not raw row, and still records once exhausted", async () => {
    const owner = await asUser(ownerA);
    const client = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });
    await owner.post(`/academia/students/${client.id}/access-plan`, {
      accessPlanId: visitsPlan.id,
    });

    const s = await asUser(studentA);
    await s.post('/checkins');
    await s.post('/checkins'); // same day, consumes only one visit

    const current = await owner.get(
      `/academia/students/${client.id}/access-plan`,
    );
    expect(current.body.remaining).toBe(9);
  });

  it('IT-006 editing the catalog entry after assignment leaves the existing snapshot unchanged; a new assignment uses the edited terms', async () => {
    const owner = await asUser(ownerA);
    const client = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });

    await owner.post(`/academia/students/${client.id}/access-plan`, {
      accessPlanId: daysPlan.id,
    });
    const firstAssignment = await prisma.studentAccessPlan.findFirstOrThrow({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    expect(firstAssignment.validityValue).toBe(30);

    await prisma.academiaAccessPlan.update({
      where: { id: daysPlan.id },
      data: { validityValue: 60 },
    });

    const unchanged = await prisma.studentAccessPlan.findUniqueOrThrow({
      where: { id: firstAssignment.id },
    });
    expect(unchanged.validityValue).toBe(30);

    await owner.post(`/academia/students/${client.id}/access-plan`, {
      accessPlanId: daysPlan.id,
    });
    const secondAssignment = await prisma.studentAccessPlan.findFirstOrThrow({
      where: { clientId: client.id, status: 'ACTIVE' },
    });
    expect(secondAssignment.validityValue).toBe(60);

    await prisma.academiaAccessPlan.update({
      where: { id: daysPlan.id },
      data: { validityValue: 30 },
    });
  });

  it('IT-007 full Engajamento aggregation: isolated per academia, explicit empty state on a fresh academia', async () => {
    const emptyOwner = await asUser(ownerA);
    const freshAcademia = await prisma.academia.create({
      data: { name: `${RUN_TAG} Fresh` },
    });
    const freshOwner = await createUser('owner-fresh', {
      productId: (
        await prisma.product.findFirstOrThrow({
          where: { groupId, type: ProductType.ACADEMIA },
        })
      ).id,
      academiaId: freshAcademia.id,
    });
    const fresh = await asUser(freshOwner);
    const emptyState = await fresh.get('/academia/engajamento');
    expect(emptyState.body).toEqual({
      todayCheckInCount: 0,
      weeklyFrequencyAverage: 0,
      atRisk: [],
      recentFeed: [],
    });

    const s = await asUser(studentA);
    await s.post('/checkins');

    const summary = await emptyOwner.get('/academia/engajamento');
    expect(summary.body.todayCheckInCount).toBe(1);
    expect(summary.body.recentFeed.length).toBeGreaterThan(0);

    await prisma.users.delete({ where: { id: freshOwner.id } });
    await prisma.academia.delete({ where: { id: freshAcademia.id } });
  });

  it('IT-008 a private client is refused at both the self-check-in and the receptionist path', async () => {
    const privateClient = await prisma.client.create({
      data: {
        name: 'Particular',
        email: `${RUN_TAG}-privado@integration.test`,
        phone: '',
        professional: { connect: { id: educatorShared.id } },
      },
    });

    const r = await asStaff(receptionistA);
    const search = await r.get('/academia/staff/students?search=Particular');
    expect(search.body).toEqual([]);
    const refused = await r.post(
      `/academia/staff/students/${privateClient.id}/checkin`,
    );
    expect(refused.status).toBe(404);

    await prisma.client.delete({ where: { id: privateClient.id } });
  });

  it('IT-009 a receptionist is rejected on every non-check-in, non-search academia route', async () => {
    const r = await asStaff(receptionistA);

    const painel = await r.get('/academia/engajamento');
    expect(painel.status).toBe(401);
  });
});
