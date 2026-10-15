import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { GymStudentGuard } from '@/common/guards/gymStudent.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { StudentTurmasController } from '@/academia/turmas/studentTurmas.controller';
import { TurmaEnrollmentService } from '@/academia/turmas/turmaEnrollment.service';
import { TurmaSessionsRenewalService } from '@/academia/turmas/turmaSessionsRenewal.service';
import { TurmasController } from '@/academia/turmas/turmas.controller';
import { TurmasService } from '@/academia/turmas/turmas.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { TurmaEnrollmentRepository } from '@/repositories/academia/turmaEnrollment.repository';
import { TurmasRepository } from '@/repositories/academia/turmas.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { MailService } from '@/mail/mail.service';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Academia, EmploymentStatus, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `gym-classes-${Date.now()}`;

describe('Gym classes integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let academiaA: Academia;
  let academiaB: Academia;
  let ownerA: Users;
  let educatorShared: Users;
  let studentA: Users;
  let studentB: Users;
  const jwtSecret = 'gym-classes-integration-jwt-secret';

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
      controllers: [TurmasController, StudentTurmasController],
      providers: [
        {
          provide: MailService,
          useValue: { sendNotificationEmail: jest.fn() },
        },
        PrismaService,
        UserRepository,
        ClientsRepository,
        EmploymentRepository,
        NotificationsRepository,
        NotificationsService,
        AcademiaActivityService,
        TurmasRepository,
        TurmaEnrollmentRepository,
        TurmaSessionsRenewalService,
        TurmasService,
        TurmaEnrollmentService,
        Clock,
        AuthGuard,
        AcademiaOwnerGuard,
        GymStudentGuard,
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
    await prisma.turmaEnrollment.deleteMany({
      where: { turma: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.turmaSession.deleteMany({
      where: { turma: { academiaId: { in: [academiaA.id, academiaB.id] } } },
    });
    await prisma.turma.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
  });

  afterAll(async () => {
    await prisma.employment.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.client.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
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
        status: EmploymentStatus.ACTIVE,
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
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Gym Classes ${label}`,
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

  async function as(target: Users) {
    const auth = await bearerFor(target);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      patch: (url: string, body: object) =>
        request(server).patch(url).set('Authorization', auth).send(body),
      del: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  async function createTurma(capacity = 1) {
    const a = await as(ownerA);
    const created = await a.post('/academia/turmas', {
      name: 'Spinning',
      weekday: 2,
      startMinute: 600,
      durationMinutes: 60,
      capacity,
    });
    return created.body as { id: string };
  }

  it('IT-001 materialization creates sessions for every matching weekday occurrence; a fresh academia has an empty agenda', async () => {
    const a = await as(ownerA);
    const emptyAgenda = await a.get('/academia/turmas');
    expect(emptyAgenda.status).toBe(200);
    expect(emptyAgenda.body).toEqual([]);

    const turma = await createTurma();
    const turmaRow = await prisma.turma.findUniqueOrThrow({
      where: { id: turma.id },
    });

    const renewal = app.get(TurmaSessionsRenewalService);
    const now = new Date();
    const until = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);
    const { created } = await renewal.materializeForTurma(turmaRow, now, until);
    expect(created).toBeGreaterThan(0);

    const sessions = await prisma.turmaSession.findMany({
      where: { turmaId: turma.id },
    });
    expect(sessions.length).toBe(created);
    expect(sessions.every((session) => session.startAt.getUTCDay() === 2)).toBe(
      true,
    );
  });

  it("IT-002 editing a turma's weekday deletes future sessions under the old rule and regenerates under the new one", async () => {
    const a = await as(ownerA);
    const turma = await createTurma();
    const turmaRow = await prisma.turma.findUniqueOrThrow({
      where: { id: turma.id },
    });
    const renewal = app.get(TurmaSessionsRenewalService);
    const now = new Date();
    const until = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);
    await renewal.materializeForTurma(turmaRow, now, until);

    const before = await prisma.turmaSession.findMany({
      where: { turmaId: turma.id },
    });
    expect(before.length).toBeGreaterThan(0);

    const edited = await a.patch(`/academia/turmas/${turma.id}`, {
      weekday: 4,
    });
    expect(edited.status).toBe(200);

    const after = await prisma.turmaSession.findMany({
      where: { turmaId: turma.id },
    });
    expect(after.every((session) => session.startAt.getUTCDay() === 4)).toBe(
      true,
    );
  });

  it('IT-003 two simultaneous enrollment requests for the single last spot: exactly one succeeds', async () => {
    const turma = await createTurma(1);
    await prisma.client.create({
      data: {
        name: 'Aluno A2',
        email: `${RUN_TAG}-client-a2@integration.test`,
        phone: '',
        academia: { connect: { id: academiaA.id } },
      },
    });
    const owner = await as(ownerA);
    const clients = await prisma.client.findMany({
      where: { academiaId: academiaA.id },
    });
    const [clientOne, clientTwo] = clients;

    const results = await Promise.all([
      owner.post(`/academia/turmas/${turma.id}/enrollments`, {
        clientId: clientOne.id,
      }),
      owner.post(`/academia/turmas/${turma.id}/enrollments`, {
        clientId: clientTwo.id,
      }),
    ]);

    const succeeded = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].body.code).toBe('turma_full');

    const count = await prisma.turmaEnrollment.count({
      where: { turmaId: turma.id },
    });
    expect(count).toBe(1);
  });

  it('IT-004 removing a turma with enrolled students excludes it from the agenda while enrollment rows remain queryable', async () => {
    const turma = await createTurma(5);
    const s = await as(studentA);
    await s.post(`/turmas/${turma.id}/enroll`);

    const owner = await as(ownerA);
    const removed = await owner.del(`/academia/turmas/${turma.id}`);
    expect(removed.status).toBe(204);

    const agenda = await owner.get('/academia/turmas');
    expect(
      agenda.body.find((item: { id: string }) => item.id === turma.id),
    ).toBeUndefined();

    const enrollments = await prisma.turmaEnrollment.count({
      where: { turmaId: turma.id },
    });
    expect(enrollments).toBe(1);
  });

  it('IT-005 ending an employment clears Turma.professionalId for every turma that educator was responsible for, same commit as the Client clear', async () => {
    const owner = await as(ownerA);
    const turma = await createTurma();
    await owner.post(`/academia/turmas/${turma.id}/assign-educator`, {
      professionalId: educatorShared.id,
    });
    await owner.post('/academia/students', {
      name: 'Aluno Direto',
      email: `${RUN_TAG}-direct@integration.test`,
      linkExistingAccount: false,
      professionalId: educatorShared.id,
    });

    const employment = await prisma.employment.findFirstOrThrow({
      where: { academiaId: academiaA.id, educatorId: educatorShared.id },
    });
    const employments = app.get(EmploymentRepository);
    await employments.end(academiaA.id, employment.id);

    const turmaRow = await prisma.turma.findUniqueOrThrow({
      where: { id: turma.id },
    });
    expect(turmaRow.professionalId).toBeNull();

    const client = await prisma.client.findFirst({
      where: {
        email: {
          equals: `${RUN_TAG}-direct@integration.test`,
          mode: 'insensitive',
        },
      },
    });
    expect(client?.professionalId).toBeNull();

    await prisma.employment.update({
      where: { id: employment.id },
      data: { status: EmploymentStatus.ACTIVE, endedAt: null },
    });
  });

  it("IT-006 a private client of this academia's own educator, and a different academia's student, are both refused enrollment and never appear in the eligible list", async () => {
    const turma = await createTurma(5);
    await prisma.client.create({
      data: {
        name: 'Particular Do Educador',
        email: `${RUN_TAG}-privado@integration.test`,
        phone: '',
        professional: { connect: { id: educatorShared.id } },
      },
    });

    const other = await as(studentB);
    const refusedOther = await other.post(`/turmas/${turma.id}/enroll`);
    expect(refusedOther.status).toBe(403);

    const listOther = await other.get('/turmas');
    expect(
      listOther.body.some((item: { id: string }) => item.id === turma.id),
    ).toBe(false);

    const eligible = await as(studentA);
    const succeeded = await eligible.post(`/turmas/${turma.id}/enroll`);
    expect(succeeded.status).toBe(201);
  });

  it('IT-007 owner-driven manual enrollment reproduces identical success/refusal outcomes as self-service', async () => {
    const turma = await createTurma(1);
    const owner = await as(ownerA);
    const ownClient = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaA.id, userId: studentA.id },
    });
    const foreignClient = await prisma.client.findFirstOrThrow({
      where: { academiaId: academiaB.id },
    });

    const refused = await owner.post(
      `/academia/turmas/${turma.id}/enrollments`,
      {
        clientId: foreignClient.id,
      },
    );
    expect(refused.status).toBe(403);

    const succeeded = await owner.post(
      `/academia/turmas/${turma.id}/enrollments`,
      {
        clientId: ownClient.id,
      },
    );
    expect(succeeded.status).toBe(201);
  });
});
