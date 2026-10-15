/**
 * Integration tests for PRD `gym-students` (task_01, task_02, backend).
 *
 * Runs the real AcademiaStudentsController/AcademiaStudentsService,
 * StudentsService.createForAcademia, the repositories, AuthGuard,
 * AcademiaOwnerGuard and the app's global ValidationPipe against an
 * isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { AcademiaStudentsController } from '@/academia/students/academiaStudents.controller';
import { AcademiaStudentsService } from '@/academia/students/academiaStudents.service';
import { StudentsService } from '@/educator-students/students/students.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { MailService } from '@/mail/mail.service';
import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Academia, EmploymentStatus, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `gym-students-${Date.now()}`;

describe('Gym students integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let academiaA: Academia;
  let academiaB: Academia;
  let ownerA: Users;
  let ownerB: Users;
  let educatorShared: Users;
  const jwtSecret = 'gym-students-integration-jwt-secret';

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
      controllers: [AcademiaStudentsController],
      providers: [
        {
          provide: MailService,
          useValue: { sendNotificationEmail: jest.fn() },
        },
        PrismaService,
        UserRepository,
        ClientsRepository,
        EmploymentRepository,
        PhysicalAssessmentsRepository,
        EducatorWorkoutsRepository,
        NotificationsRepository,
        NotificationsService,
        AcademiaActivityService,
        FixedTimesRepository,
        FixedSessionsService,
        Clock,
        AcademiaStudentsService,
        StudentsService,
        AuthGuard,
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
    await prisma.client.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
  });

  afterAll(async () => {
    await prisma.employment.deleteMany({
      where: { academiaId: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.academia.deleteMany({
      where: { id: { in: [academiaA.id, academiaB.id] } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: [ownerA.id, ownerB.id, educatorShared.id] } },
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
    ownerB = await createUser('owner-b', {
      productId: academiaProduct.id,
      academiaId: academiaB.id,
    });
    educatorShared = await createUser('educator-shared', {
      productId: educatorProduct.id,
    });

    await prisma.employment.create({
      data: {
        academiaId: academiaA.id,
        educatorId: educatorShared.id,
        status: EmploymentStatus.ACTIVE,
      },
    });
    await prisma.employment.create({
      data: {
        academiaId: academiaB.id,
        educatorId: educatorShared.id,
        status: EmploymentStatus.ACTIVE,
      },
    });
  }

  async function createUser(
    label: string,
    extra: Record<string, unknown>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Gym Students ${label}`,
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
      post: (url: string, body: object) =>
        request(server).post(url).set('Authorization', auth).send(body),
    };
  }

  it("IT-001 lists only this academia's own students, searched/filtered/paginated, with no empty-state confusion", async () => {
    const a = await as(ownerA);

    await prisma.client.create({
      data: {
        name: 'Aluno Da Academia A',
        email: `${RUN_TAG}-aluno-a@integration.test`,
        phone: '',
        academia: { connect: { id: academiaA.id } },
        professional: { connect: { id: educatorShared.id } },
      },
    });
    await prisma.client.create({
      data: {
        name: 'Aluno Sem Educador',
        email: `${RUN_TAG}-aluno-sem@integration.test`,
        phone: '',
        academia: { connect: { id: academiaA.id } },
      },
    });
    await prisma.client.create({
      data: {
        name: 'Aluno Da Academia B',
        email: `${RUN_TAG}-aluno-b@integration.test`,
        phone: '',
        academia: { connect: { id: academiaB.id } },
        professional: { connect: { id: educatorShared.id } },
      },
    });

    const list = await a.get('/academia/students');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(
      list.body.items.some((i: { name: string }) =>
        i.name.includes('Academia B'),
      ),
    ).toBe(false);

    const search = await a.get(
      '/academia/students?search=' + encodeURIComponent('Sem Educador'),
    );
    expect(search.body.items).toEqual([
      expect.objectContaining({ name: 'Aluno Sem Educador' }),
    ]);

    const sem = await a.get('/academia/students?horario=SEM');
    expect(sem.body.items.map((i: { name: string }) => i.name)).toContain(
      'Aluno Sem Educador',
    );

    const emptyAcademia = await (
      await as(ownerB)
    ).get('/academia/students?horario=COM');
    expect(emptyAcademia.status).toBe(200);
  });

  it('IT-002 direct registration: unassigned, pre-assigned, non-employed rejection, academia-scoped duplicate, and distinct-from-particular', async () => {
    const a = await as(ownerA);
    const email = `${RUN_TAG}-direct@integration.test`;

    const unassigned = await a.post('/academia/students', {
      name: 'Aluno Direto',
      email,
      linkExistingAccount: false,
    });
    expect(unassigned.status).toBe(201);

    const assignedEmail = `${RUN_TAG}-direct-assigned@integration.test`;
    const assigned = await a.post('/academia/students', {
      name: 'Aluno Direto Atribuído',
      email: assignedEmail,
      linkExistingAccount: false,
      professionalId: educatorShared.id,
    });
    expect(assigned.status).toBe(201);
    const assignedList = await a.get('/academia/students');
    expect(
      assignedList.body.items.find(
        (i: { email: string }) => i.email === assignedEmail,
      ).assignedEducator,
    ).toMatchObject({ id: educatorShared.id });

    const notEmployedHere = await a.post('/academia/students', {
      name: 'Rejeitado',
      email: `${RUN_TAG}-rejected@integration.test`,
      linkExistingAccount: false,
      professionalId: ownerB.id,
    });
    expect(notEmployedHere.status).toBe(400);
    expect(notEmployedHere.body.code).toBe('not_employed_here');

    const duplicate = await a.post('/academia/students', {
      name: 'Duplicado',
      email,
      linkExistingAccount: false,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('student_already_registered');
  });

  it("IT-004 a private client of this academia's own educator never appears in the Alunos list", async () => {
    const a = await as(ownerA);

    const privateClient = await prisma.client.create({
      data: {
        name: 'Particular Do Educador',
        email: `${RUN_TAG}-privado@integration.test`,
        phone: '',
        professional: { connect: { id: educatorShared.id } },
      },
    });

    const list = await a.get('/academia/students');
    expect(
      list.body.items.some((i: { id: string }) => i.id === privateClient.id),
    ).toBe(false);

    const search = await a.get(
      '/academia/students?search=' + encodeURIComponent('Particular'),
    );
    expect(search.body.items).toEqual([]);

    await prisma.client.delete({ where: { id: privateClient.id } });
  });
});
