/**
 * Integration tests for PRD `exercise-library` (task_02, backend).
 *
 * Runs the real exercise-library controllers, service, repositories,
 * AuthGuard, BackofficeGuard and the app's global ValidationPipe against an
 * isolated database. Nothing is mocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { ExerciseAdminController } from '@/exercise-library/exerciseAdmin.controller';
import { ExerciseLibraryService } from '@/exercise-library/exerciseLibrary.service';
import { ExerciseSubmissionsController } from '@/exercise-library/exerciseSubmissions.controller';
import { ExercisesController } from '@/exercise-library/exercises.controller';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication, Logger } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Exercise,
  ExerciseEquipment,
  ExerciseStatus,
  Prisma,
  ProductType,
  Users,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `exlib-${Date.now()}`;

describe('Exercise library integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let student: Users;
  let educator: Users;
  let backoffice: Users;
  let educatorGroupId: string;
  const jwtSecret = 'exercise-library-integration-jwt-secret';

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
        ExerciseSubmissionsController,
        ExercisesController,
        ExerciseAdminController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ExercisesRepository,
        ExerciseLibraryService,
        AuthGuard,
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

  afterEach(async () => {
    await prisma.exercise.deleteMany({
      where: { name: { startsWith: RUN_TAG } },
    });
  });

  afterAll(async () => {
    const userIds = [student, educator, backoffice]
      .filter(Boolean)
      .map((user) => user.id);
    await prisma.exercise.deleteMany({
      where: {
        OR: [
          { submittedById: { in: userIds } },
          { reviewedById: { in: userIds } },
        ],
      },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId: educatorGroupId } });
    await prisma.productGroup.deleteMany({ where: { id: educatorGroupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} educator group`,
        products: {
          create: {
            name: `${RUN_TAG} educator`,
            price: 0,
            type: ProductType.PHYSICAL_EDUCATOR,
          },
        },
      },
      include: { products: true },
    });
    educatorGroupId = group.id;

    student = await createUser('student', {});
    educator = await createUser('educator', {
      productId: group.products[0].id,
    });
    backoffice = await createUser('backoffice', { isBackoffice: true });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Exercise ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function bearer(user: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: user.id,
      email: user.email,
    });
    return `Bearer ${token}`;
  }

  async function seedExercise(
    overrides: Partial<Prisma.ExerciseUncheckedCreateInput> = {},
  ): Promise<Exercise> {
    return await prisma.exercise.create({
      data: {
        name: `${RUN_TAG} Exercise`,
        description: 'Seeded for integration tests.',
        muscleGroup: 'Peito',
        equipment: ExerciseEquipment.GYM,
        ...overrides,
        ...(overrides.name ? { name: `${RUN_TAG} ${overrides.name}` } : {}),
      },
    });
  }

  function ids(body: Exercise[]): string[] {
    return body.map((exercise) => exercise.id);
  }

  it('IT-001 combines muscle group, equipment and name filters over APPROVED rows', async () => {
    const match = await seedExercise({
      name: 'Supino com peso corporal',
      muscleGroup: 'Peito',
      equipment: ExerciseEquipment.BODYWEIGHT,
    });
    await seedExercise({
      name: 'Supino reto',
      muscleGroup: 'Peito',
      equipment: ExerciseEquipment.GYM,
    });
    await seedExercise({
      name: 'Supino costas',
      muscleGroup: 'Costas',
      equipment: ExerciseEquipment.BODYWEIGHT,
    });
    await seedExercise({
      name: 'Flexão',
      muscleGroup: 'Peito',
      equipment: ExerciseEquipment.BODYWEIGHT,
    });
    await seedExercise({
      name: 'Supino pendente',
      muscleGroup: 'Peito',
      equipment: ExerciseEquipment.BODYWEIGHT,
      status: ExerciseStatus.PENDING,
    });

    const response = await request(app.getHttpServer())
      .get('/exercises')
      .query({ muscleGroup: 'Peito', equipment: 'BODYWEIGHT', q: 'supino' })
      .set('Authorization', await bearer(student))
      .expect(200);

    expect(ids(response.body)).toEqual([match.id]);
    expect(response.body[0].status).toBe(ExerciseStatus.APPROVED);
  });

  it('IT-001 treats LIKE wildcards in the search as literal text', async () => {
    const literal = await seedExercise({ name: 'Rosca 100% concentrada' });
    await seedExercise({ name: 'Rosca martelo' });

    const response = await request(app.getHttpServer())
      .get('/exercises')
      .query({ q: `${RUN_TAG} Rosca 100%` })
      .set('Authorization', await bearer(student))
      .expect(200);

    expect(ids(response.body)).toEqual([literal.id]);

    // A bare `%` only matches names that literally contain one; `%%%`
    // matches none, instead of every row as an unescaped wildcard would.
    const singlePercent = await request(app.getHttpServer())
      .get('/exercises')
      .query({ q: '%' })
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(ids(singlePercent.body)).toEqual([literal.id]);

    const wildcardOnly = await request(app.getHttpServer())
      .get('/exercises')
      .query({ q: '%%%' })
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(wildcardOnly.body).toEqual([]);
  });

  it('IT-002 never lists a PENDING or REJECTED row, under any filter', async () => {
    const pending = await seedExercise({
      name: 'Pendente',
      status: ExerciseStatus.PENDING,
      equipment: ExerciseEquipment.HOME_BASIC,
    });
    const rejected = await seedExercise({
      name: 'Rejeitado',
      status: ExerciseStatus.REJECTED,
    });
    const hidden = [pending.id, rejected.id];
    const queries = [
      {},
      { muscleGroup: 'Peito' },
      { equipment: 'HOME_BASIC' },
      { q: RUN_TAG },
      { muscleGroup: 'Peito', equipment: 'HOME_BASIC', q: 'Pendente' },
    ];

    for (const query of queries) {
      const response = await request(app.getHttpServer())
        .get('/exercises')
        .query(query)
        .set('Authorization', await bearer(student))
        .expect(200);
      for (const id of hidden) {
        expect(ids(response.body)).not.toContain(id);
      }
    }

    await request(app.getHttpServer())
      .get(`/exercises/${pending.id}`)
      .set('Authorization', await bearer(student))
      .expect(404);
  });

  it('IT-003 a backoffice edit shows up on the next read, not before', async () => {
    const exercise = await seedExercise({ name: 'Bench Press' });

    const before = await request(app.getHttpServer())
      .get(`/exercises/${exercise.id}`)
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(before.body.name).toBe(`${RUN_TAG} Bench Press`);

    await request(app.getHttpServer())
      .patch(`/admin/exercises/${exercise.id}`)
      .set('Authorization', await bearer(backoffice))
      .send({ name: `${RUN_TAG} Supino reto`, contraindications: ['SHOULDER'] })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/exercises/${exercise.id}`)
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(after.body).toMatchObject({
      name: `${RUN_TAG} Supino reto`,
      contraindications: ['SHOULDER'],
    });
    expect(before.body.name).toBe(`${RUN_TAG} Bench Press`);
  });

  it('IT-004 an educator submission is PENDING in their own list', async () => {
    const created = await request(app.getHttpServer())
      .post('/exercises/submissions')
      .set('Authorization', await bearer(educator))
      .send({
        name: `${RUN_TAG} Remada unilateral`,
        description: 'Apoie um joelho no banco e puxe o halter.',
        muscleGroup: 'Costas',
        equipment: 'HOME_BASIC',
        contraindications: ['SPINE'],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: ExerciseStatus.PENDING,
      submittedById: educator.id,
    });

    const mine = await request(app.getHttpServer())
      .get('/exercises/submissions/mine')
      .set('Authorization', await bearer(educator))
      .expect(200);
    expect(mine.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        status: ExerciseStatus.PENDING,
      }),
    ]);

    const list = await request(app.getHttpServer())
      .get('/exercises')
      .query({ q: RUN_TAG })
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(ids(list.body)).not.toContain(created.body.id);
  });

  it('IT-004 refuses submissions from non-educators and client-sent status', async () => {
    const body = {
      name: `${RUN_TAG} Tentativa`,
      description: 'x',
      muscleGroup: 'Peito',
      equipment: 'GYM',
    };

    await request(app.getHttpServer())
      .post('/exercises/submissions')
      .set('Authorization', await bearer(student))
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/exercises/submissions')
      .set('Authorization', await bearer(educator))
      .send({ ...body, status: 'APPROVED' })
      .expect(400);
  });

  it('IT-005 approve publishes one submission, reject never does', async () => {
    const toApprove = await seedExercise({
      name: 'Aprovar',
      status: ExerciseStatus.PENDING,
      submittedById: educator.id,
    });
    const toReject = await seedExercise({
      name: 'Rejeitar',
      status: ExerciseStatus.PENDING,
      submittedById: educator.id,
    });

    const pending = await request(app.getHttpServer())
      .get('/admin/exercises/pending')
      .set('Authorization', await bearer(backoffice))
      .expect(200);
    expect(ids(pending.body)).toEqual(
      expect.arrayContaining([toApprove.id, toReject.id]),
    );

    const approved = await request(app.getHttpServer())
      .post(`/admin/exercises/${toApprove.id}/approve`)
      .set('Authorization', await bearer(backoffice))
      .expect(200);
    expect(approved.body).toMatchObject({
      status: ExerciseStatus.APPROVED,
      reviewedById: backoffice.id,
    });

    const rejected = await request(app.getHttpServer())
      .post(`/admin/exercises/${toReject.id}/reject`)
      .set('Authorization', await bearer(backoffice))
      .send({ reason: 'Duplicado.' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: ExerciseStatus.REJECTED,
      rejectionReason: 'Duplicado.',
    });

    const list = await request(app.getHttpServer())
      .get('/exercises')
      .query({ q: RUN_TAG })
      .set('Authorization', await bearer(student))
      .expect(200);
    expect(ids(list.body)).toContain(toApprove.id);
    expect(ids(list.body)).not.toContain(toReject.id);
  });

  it('IT-005 admin routes refuse authenticated non-backoffice users', async () => {
    const pending = await seedExercise({
      name: 'Protegido',
      status: ExerciseStatus.PENDING,
    });

    await request(app.getHttpServer())
      .get('/admin/exercises/pending')
      .set('Authorization', await bearer(educator))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/admin/exercises/${pending.id}/approve`)
      .set('Authorization', await bearer(student))
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/exercises/pending')
      .expect(401);

    const unchanged = await prisma.exercise.findUnique({
      where: { id: pending.id },
    });
    expect(unchanged?.status).toBe(ExerciseStatus.PENDING);
  });

  it('IT-006 of two concurrent approvals exactly one wins, the other gets 409', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const pending = await seedExercise({
      name: 'Corrida',
      status: ExerciseStatus.PENDING,
    });
    const authorization = await bearer(backoffice);

    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/admin/exercises/${pending.id}/approve`)
          .set('Authorization', authorization),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.message).toBe('Exercício já está aprovado.');
  });

  it('IT-007 backoffice create, edit and delete round-trip', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/exercises')
      .set('Authorization', await bearer(backoffice))
      .send({
        name: `${RUN_TAG} Prancha`,
        description: 'Sustente o corpo apoiado nos antebraços.',
        muscleGroup: 'Abdômen',
        equipment: 'BODYWEIGHT',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: ExerciseStatus.APPROVED,
      sourceAttribution: null,
      contraindications: [],
    });
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .get(`/exercises/${id}`)
      .set('Authorization', await bearer(student))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/admin/exercises/${id}`)
      .set('Authorization', await bearer(backoffice))
      .send({ name: '' })
      .expect(400);

    const edited = await request(app.getHttpServer())
      .patch(`/admin/exercises/${id}`)
      .set('Authorization', await bearer(backoffice))
      .send({ equipment: 'HOME_BASIC', difficulty: 'Iniciante' })
      .expect(200);
    expect(edited.body).toMatchObject({
      equipment: 'HOME_BASIC',
      difficulty: 'Iniciante',
      name: `${RUN_TAG} Prancha`,
    });

    await request(app.getHttpServer())
      .delete(`/admin/exercises/${id}`)
      .set('Authorization', await bearer(backoffice))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/exercises/${id}`)
      .set('Authorization', await bearer(student))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/admin/exercises/${id}`)
      .set('Authorization', await bearer(backoffice))
      .expect(404);
  });
});
