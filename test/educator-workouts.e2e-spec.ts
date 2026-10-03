/**
 * Integration tests for PRD `educator-workouts` (tasks 1 and 2, backend).
 *
 * Runs the real workouts, students, mirror and student controllers and
 * services, the repositories, AuthGuard, PhysicalEducatorGuard, the real
 * NotificationsService and the app's global ValidationPipe against an isolated
 * database. Only `MailService` (no SMTP) and the professional profile lookup
 * of Professional Discovery (the mirror only needs the educator's identity)
 * are stubbed.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AccountLookupThrottlerGuard } from '@/educator-students/students/accountLookupThrottler.guard';
import { StudentsController } from '@/educator-students/students/students.controller';
import { StudentsService } from '@/educator-students/students/students.service';
import { StudentWorkoutsController } from '@/educator-students/workouts/studentWorkouts.controller';
import { StudentWorkoutsService } from '@/educator-students/workouts/studentWorkouts.service';
import { WorkoutNotificationsService } from '@/educator-students/workouts/workoutNotifications.service';
import { WorkoutsController } from '@/educator-students/workouts/workouts.controller';
import { toCopyTree } from '@/educator-students/workouts/workoutTree.util';
import { EducatorWorkoutsService } from '@/educator-students/workouts/workouts.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ProfessionalMirrorController } from '@/professional-mirror/professionalMirror.controller';
import { ProfessionalMirrorService } from '@/professional-mirror/professionalMirror.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(120_000);

const RUN_TAG = `edu-workouts-${Date.now()}`;
const RANDOM_UUID = '01890a5d-ac96-774b-bcce-b302099a8099';

describe('Educator workouts integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clientsRepo: ClientsRepository;
  let workoutsRepo: EducatorWorkoutsRepository;
  let jwtService: JwtService;
  let groupId: string;
  let educatorA: Users;
  let educatorB: Users;
  let nutritionist: Users;
  let regularUser: Users;
  let studentUser: Users;
  let secondStudentUser: Users;
  let kneeExercise: { id: string };
  let plainExercise: { id: string };
  let pendingExercise: { id: string };
  const sendNotificationEmail = jest.fn();
  const jwtSecret = 'educator-workouts-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: jwtSecret }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
      ],
      controllers: [
        StudentsController,
        WorkoutsController,
        StudentWorkoutsController,
        ProfessionalMirrorController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        PhysicalAssessmentsRepository,
        EducatorWorkoutsRepository,
        ExercisesRepository,
        FitnessProfileRepository,
        NotificationsRepository,
        NotificationsService,
        WorkoutNotificationsService,
        EducatorWorkoutsService,
        StudentWorkoutsService,
        StudentsService,
        ProfessionalMirrorService,
        AuthGuard,
        PhysicalEducatorGuard,
        AccountLookupThrottlerGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
        {
          provide: ProfessionalDiscoveryService,
          useValue: {
            getProfile: async (id: string) => {
              const row = await prisma.users.findUniqueOrThrow({
                where: { id },
              });
              return { id: row.id, name: row.name, specialty: null };
            },
          },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    clientsRepo = moduleFixture.get(ClientsRepository);
    workoutsRepo = moduleFixture.get(EducatorWorkoutsRepository);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
    sendNotificationEmail.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const ids = [educatorA, educatorB, nutritionist].map((u) => u.id);
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.notification.deleteMany({
      where: { userId: { in: [studentUser.id, secondStudentUser.id] } },
    });
    await prisma.notificationPreference.deleteMany({
      where: { userId: { in: [studentUser.id, secondStudentUser.id] } },
    });
    await prisma.fitnessProfile.deleteMany({
      where: { userId: { in: [studentUser.id, secondStudentUser.id] } },
    });
  });

  afterAll(async () => {
    const users = [
      educatorA,
      educatorB,
      nutritionist,
      regularUser,
      studentUser,
      secondStudentUser,
    ].filter(Boolean);
    const ids = users.map((u) => u.id);
    await prisma.exercise.deleteMany({
      where: { name: { startsWith: RUN_TAG } },
    });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
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
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
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
    const nutriProduct = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!;

    educatorA = await createUser('educator-a', {
      name: 'Thiago Ramos',
      productId: educatorProduct.id,
    });
    educatorB = await createUser('educator-b', {
      name: 'Marina Costa',
      productId: educatorProduct.id,
    });
    nutritionist = await createUser('nutri', { productId: nutriProduct.id });
    regularUser = await createUser('regular', {});
    studentUser = await createUser('student', { name: 'Diego Aluno' });
    secondStudentUser = await createUser('student2', { name: 'Paula Aluna' });

    const base = {
      description: 'd',
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: 'GYM' as const,
      status: 'APPROVED' as const,
    };
    kneeExercise = await prisma.exercise.create({
      data: {
        ...base,
        name: `${RUN_TAG} Agachamento`,
        muscleGroup: 'Pernas',
        contraindications: ['KNEE'],
        videoUrl: 'https://library.test/agachamento',
      },
    });
    plainExercise = await prisma.exercise.create({
      data: {
        ...base,
        name: `${RUN_TAG} Remada`,
        muscleGroup: 'Costas',
        contraindications: [],
      },
    });
    pendingExercise = await prisma.exercise.create({
      data: {
        ...base,
        name: `${RUN_TAG} Pendente`,
        muscleGroup: 'Peito',
        contraindications: [],
        status: 'PENDING',
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Workouts ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function as(target: Users) {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      put: (url: string, body: object) =>
        request(server).put(url).set('Authorization', auth).send(body),
      del: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  // A student record of `educator`, linked to `account` when given.
  async function registerStudent(
    educator: Users,
    email: string,
    account?: Users,
  ): Promise<string> {
    const caller = await as(educator);
    const response = await caller.post(
      '/educator/students',
      account
        ? { email: account.email, linkExistingAccount: true }
        : { name: 'Aluno Teste', email, linkExistingAccount: false },
    );
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  const base = (studentId: string) =>
    `/educator/students/${studentId}/workouts`;

  const libraryItem = (extra: object = {}) => ({
    source: 'LIBRARY',
    exerciseId: plainExercise.id,
    sets: 3,
    reps: '8-12',
    ...extra,
  });
  const freeItem = (extra: object = {}) => ({
    source: 'FREE',
    name: 'Prancha',
    muscleGroup: 'Abdômen',
    sets: 3,
    reps: '30s',
    ...extra,
  });
  const validTree = (extra: object = {}) => ({
    title: 'Hipertrofia',
    weeklyFrequency: 4,
    sessions: [
      { name: 'Peito', exercises: [libraryItem(), freeItem()] },
      { name: 'Costas', exercises: [freeItem({ name: 'Remada livre' })] },
    ],
    ...extra,
  });

  // Creates a draft with a valid tree already saved.
  async function draftWithTree(
    educator: Users,
    studentId: string,
    tree: object = validTree(),
  ) {
    const caller = await as(educator);
    const created = await caller.post(base(studentId), { title: 'Treino' });
    expect(created.status).toBe(201);
    const saved = await caller.put(
      `${base(studentId)}/${created.body.id}`,
      tree,
    );
    expect(saved.status).toBe(200);
    return saved.body as {
      id: string;
      status: string;
      sessions: Array<{ id: string; exercises: Array<{ id: string }> }>;
    };
  }

  async function activeCount(clientId: string): Promise<number> {
    return await prisma.educatorWorkout.count({
      where: { clientId, status: 'ACTIVE' },
    });
  }

  async function notificationsOf(user: Users) {
    return await prisma.notification.findMany({
      where: { userId: user.id, category: 'WORKOUT_PLAN' },
    });
  }

  async function moveWindowBack(
    workoutId: string,
    minutes = 31,
  ): Promise<void> {
    await prisma.educatorWorkout.update({
      where: { id: workoutId },
      data: { lastEditNotifiedAt: new Date(Date.now() - minutes * 60_000) },
    });
  }

  it('IT-001 isolates one educator workouts from another, with the same 404 as for random ids', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-one@integration.test`,
    );
    const workout = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const b = await as(educatorB);

    expect((await a.get(base(studentId))).body.drafts).toHaveLength(1);

    const own = `${base(studentId)}/${workout.id}`;
    const unknown = `${base(RANDOM_UUID)}/${RANDOM_UUID}`;
    const pairs: Array<
      [Awaited<ReturnType<typeof b.get>>, Awaited<ReturnType<typeof b.get>>]
    > = [
      [await b.get(base(studentId)), await b.get(base(RANDOM_UUID))],
      [await b.get(own), await b.get(unknown)],
      [await b.put(own, validTree()), await b.put(unknown, validTree())],
      [await b.post(`${own}/activate`), await b.post(`${unknown}/activate`)],
      [
        await b.post(`${own}/deactivate`),
        await b.post(`${unknown}/deactivate`),
      ],
      [await b.del(own), await b.del(unknown)],
      [
        await b.post(`${own}/duplicate`, { studentIds: [studentId] }),
        await b.post(`${unknown}/duplicate`, { studentIds: [studentId] }),
      ],
      [
        await b.post(`${base(studentId)}/conflicts`, {
          exerciseIds: [kneeExercise.id],
        }),
        await b.post(`${base(RANDOM_UUID)}/conflicts`, {
          exerciseIds: [kneeExercise.id],
        }),
      ],
    ];
    for (const [foreign, missing] of pairs) {
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
    }
    expect((await a.get(own)).status).toBe(200);
  });

  it('IT-002 keeps ids across saves, rewrites positions, deletes absent rows and rejects foreign ids', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-two@integration.test`,
    );
    const first = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const url = `${base(studentId)}/${first.id}`;

    const [s1, s2] = first.sessions;
    const reordered = {
      title: 'Novo nome',
      weeklyFrequency: 3,
      sessions: [
        {
          id: s2.id,
          name: 'Costas',
          exercises: [
            freeItem({ id: s2.exercises[0].id, name: 'Remada livre' }),
          ],
        },
        {
          id: s1.id,
          name: 'Peito',
          exercises: [
            freeItem({ id: s1.exercises[1].id }),
            freeItem({ name: 'Nova' }),
          ],
        },
        { name: 'Pernas', exercises: [] },
      ],
    };
    const saved = await a.put(url, reordered);

    expect(saved.status).toBe(200);
    expect(
      saved.body.sessions.map((s: { id: string }) => s.id).slice(0, 2),
    ).toEqual([s2.id, s1.id]);
    expect(saved.body.sessions.map((s: { label: string }) => s.label)).toEqual([
      'A',
      'B',
      'C',
    ]);
    const kept = saved.body.sessions[1].exercises.map(
      (e: { id: string }) => e.id,
    );
    expect(kept[0]).toBe(s1.exercises[1].id);
    expect(kept).not.toContain(s1.exercises[0].id);
    expect(
      await prisma.educatorWorkoutExercise.count({
        where: { id: s1.exercises[0].id },
      }),
    ).toBe(0);

    const other = await draftWithTree(educatorA, studentId);
    const foreign = await a.put(url, {
      title: 'x',
      sessions: [{ id: other.sessions[0].id, name: 'x', exercises: [] }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('foreign_item_id');
    expect((await a.get(url)).body.title).toBe('Novo nome');

    const [one, two] = await Promise.all([
      a.put(url, {
        ...reordered,
        title: 'Versão 1',
        sessions: [{ id: s2.id, name: 'Um', exercises: [] }],
      }),
      a.put(url, {
        ...reordered,
        title: 'Versão 2',
        sessions: [{ id: s2.id, name: 'Dois', exercises: [] }],
      }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const stored = await a.get(url);
    const pair = `${stored.body.title}|${stored.body.sessions[0].name}`;
    expect(['Versão 1|Um', 'Versão 2|Dois']).toContain(pair);
  });

  it('IT-003 shows only the active workout to the student and never a draft or archived one', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const draft = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const s = await as(studentUser);

    expect((await s.get('/me/educator-workouts')).body).toEqual({
      workouts: [],
    });

    const activated = await a.post(
      `${base(studentId)}/activate`.replace('/activate', '') +
        `/${draft.id}/activate`,
    );
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe('ACTIVE');

    const read = await s.get('/me/educator-workouts');
    expect(read.status).toBe(200);
    expect(read.body.workouts).toHaveLength(1);
    expect(read.body.workouts[0].educator.name).toBe('Thiago Ramos');
    expect(JSON.stringify(read.body)).not.toMatch(/conflicts|status|clientId/);

    const second = await draftWithTree(educatorA, studentId);
    expect(
      (await s.get('/me/educator-workouts')).body.workouts[0].workout.id,
    ).toBe(draft.id);

    const edit = await a.put(
      `${base(studentId)}/${draft.id}`,
      validTree({ title: 'Editado' }),
    );
    expect(edit.status).toBe(200);
    expect((await s.get(`/me/educator-workouts/${second.id}`)).status).toBe(
      404,
    );
    expect((await s.get(`${base(studentId)}/${second.id}`)).status).toBe(403);
  });

  it('IT-004 leaves exactly one active workout under simultaneous activations and the index refuses a second', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-four@integration.test`,
    );
    const w1 = await draftWithTree(educatorA, studentId);
    const w2 = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);

    const [r1, r2] = await Promise.all([
      a.post(`${base(studentId)}/${w1.id}/activate`),
      a.post(`${base(studentId)}/${w2.id}/activate`),
    ]);

    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await activeCount(studentId)).toBe(1);

    const active = await prisma.educatorWorkout.findFirstOrThrow({
      where: { clientId: studentId, status: 'ACTIVE' },
    });
    const archivedId = active.id === w1.id ? w2.id : w1.id;
    await expect(
      prisma.educatorWorkout.update({
        where: { id: archivedId },
        data: { status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
    expect(await activeCount(studentId)).toBe(1);
  });

  it('IT-005 leaves the previous active workout active when an activation fails midway', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-five@integration.test`,
    );
    const w1 = await draftWithTree(educatorA, studentId);
    const w2 = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    await a.post(`${base(studentId)}/${w1.id}/activate`);

    const original = prisma.$transaction.bind(prisma) as (
      cb: unknown,
    ) => Promise<unknown>;
    jest.spyOn(prisma, '$transaction').mockImplementation(((cb: unknown) => {
      if (typeof cb !== 'function') return original(cb);
      return original((tx: Prisma.TransactionClient) => {
        const failing = new Proxy(tx, {
          get(target, prop) {
            if (prop !== 'educatorWorkout')
              return Reflect.get(target, prop) as unknown;
            return new Proxy(target.educatorWorkout, {
              get(model, method) {
                if (method === 'update')
                  return () => Promise.reject(new Error('midway failure'));
                return Reflect.get(model, method) as unknown;
              },
            });
          },
        });
        return (cb as (t: unknown) => Promise<unknown>)(failing);
      });
    }) as never);

    const failed = await a.post(`${base(studentId)}/${w2.id}/activate`);
    jest.restoreAllMocks();

    expect(failed.status).toBe(500);
    const rows = await prisma.educatorWorkout.findMany({
      where: { clientId: studentId },
    });
    expect(rows.find((r) => r.id === w1.id)?.status).toBe('ACTIVE');
    expect(rows.find((r) => r.id === w2.id)?.status).toBe('DRAFT');
  });

  it('IT-006 refuses an invalid active workout with 422 and accepts the same tree for a draft', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-six@integration.test`,
    );
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const emptySession = validTree({
      sessions: [{ name: 'Vazia', exercises: [] }],
    });

    expect(
      (await a.put(`${base(studentId)}/${w.id}`, emptySession)).status,
    ).toBe(200);
    const notActivatable = await a.post(`${base(studentId)}/${w.id}/activate`);
    expect(notActivatable.status).toBe(422);
    expect(notActivatable.body.code).toBe('workout_not_activatable');
    expect(notActivatable.body.details).toEqual([
      { code: 'empty_session', sessionLabel: 'A', sessionName: 'Vazia' },
    ]);

    expect(
      (await a.put(`${base(studentId)}/${w.id}`, validTree())).status,
    ).toBe(200);
    expect((await a.post(`${base(studentId)}/${w.id}/activate`)).status).toBe(
      200,
    );
    const before = await a.get(`${base(studentId)}/${w.id}`);

    for (const invalid of [emptySession, validTree({ sessions: [] })]) {
      const refused = await a.put(`${base(studentId)}/${w.id}`, invalid);
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('workout_active_invalid');
    }
    expect((await a.get(`${base(studentId)}/${w.id}`)).body).toEqual(
      before.body,
    );

    await a.post(`${base(studentId)}/${w.id}/deactivate`);
    expect(
      (await a.put(`${base(studentId)}/${w.id}`, emptySession)).status,
    ).toBe(200);
  });

  it('IT-007 deletes drafts and archived workouts with their rows, refuses the active one, and cascades from the student', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-seven@integration.test`,
    );
    const draft = await draftWithTree(educatorA, studentId);
    const active = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    await a.post(`${base(studentId)}/${active.id}/activate`);

    expect((await a.del(`${base(studentId)}/${draft.id}`)).status).toBe(204);
    expect(
      await prisma.educatorWorkoutSession.count({
        where: { workoutId: draft.id },
      }),
    ).toBe(0);

    const refused = await a.del(`${base(studentId)}/${active.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('workout_is_active');
    expect(
      await prisma.educatorWorkout.count({ where: { id: active.id } }),
    ).toBe(1);

    await a.post(`${base(studentId)}/${active.id}/deactivate`);
    expect((await a.del(`${base(studentId)}/${active.id}`)).status).toBe(204);

    const another = await draftWithTree(educatorA, studentId);
    expect((await a.del(`/educator/students/${studentId}`)).status).toBe(204);
    expect(
      await prisma.educatorWorkout.count({ where: { id: another.id } }),
    ).toBe(0);
    expect(
      await prisma.educatorWorkoutExercise.count({
        where: { session: { workoutId: another.id } },
      }),
    ).toBe(0);
  });

  it('IT-008 duplicates to several students and the same one, and fails whole for a foreign target', async () => {
    const source = await registerStudent(
      educatorA,
      `${RUN_TAG}-src@integration.test`,
    );
    const t1 = await registerStudent(
      educatorA,
      `${RUN_TAG}-t1@integration.test`,
    );
    const t2 = await registerStudent(
      educatorA,
      `${RUN_TAG}-t2@integration.test`,
    );
    const t3 = await registerStudent(
      educatorA,
      `${RUN_TAG}-t3@integration.test`,
    );
    const foreign = await registerStudent(
      educatorB,
      `${RUN_TAG}-foreign@integration.test`,
    );
    const workout = await draftWithTree(educatorA, source);
    const a = await as(educatorA);
    await a.post(
      `${base(t1)}/${(await draftWithTree(educatorA, t1)).id}/activate`,
    );

    const copied = await a.post(`${base(source)}/${workout.id}/duplicate`, {
      studentIds: [t1, t2, t3, source],
    });

    expect(copied.status).toBe(201);
    expect(copied.body.copies).toHaveLength(4);
    const titles = await prisma.educatorWorkout.findMany({
      where: { clientId: { in: [t2, t3, source] } },
      select: { clientId: true, title: true, status: true },
    });
    expect(
      titles.find((r) => r.clientId === source && r.title.endsWith('(cópia)')),
    ).toBeDefined();
    expect(
      titles
        .filter((r) => r.clientId === t2)
        .every((r) => r.status === 'DRAFT'),
    ).toBe(true);
    expect(await activeCount(t1)).toBe(1);

    const before = await prisma.educatorWorkout.count();
    const refused = await a.post(`${base(source)}/${workout.id}/duplicate`, {
      studentIds: [t2, foreign],
    });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('duplicate_targets_invalid');
    expect(await prisma.educatorWorkout.count()).toBe(before);

    const tree = await workoutsRepo.findOwnedTree(workout.id, source);
    await expect(
      workoutsRepo.copyToClients([
        { clientId: t2, tree: toCopyTree(tree!) },
        { clientId: 'no-such-client', tree: toCopyTree(tree!) },
      ]),
    ).rejects.toThrow();
    expect(await prisma.educatorWorkout.count()).toBe(before);
  });

  it('IT-009 removes the workouts and the student read with the student, and answers 404 for it afterwards', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const s = await as(studentUser);
    await a.post(`${base(studentId)}/${w.id}/activate`);
    expect((await s.get('/me/educator-workouts')).body.workouts).toHaveLength(
      1,
    );

    expect((await a.del(`/educator/students/${studentId}`)).status).toBe(204);

    expect((await s.get('/me/educator-workouts')).body).toEqual({
      workouts: [],
    });
    expect(
      await prisma.educatorWorkout.count({ where: { clientId: studentId } }),
    ).toBe(0);
    expect(
      (await a.put(`${base(studentId)}/${w.id}`, validTree())).status,
    ).toBe(404);
  });

  it('IT-010 shows a student the active workouts of several educators and follows late linking', async () => {
    const withA = await registerStudent(educatorA, '', studentUser);
    const withB = await registerStudent(educatorB, '', studentUser);
    const unlinked = await registerStudent(
      educatorA,
      `${RUN_TAG}-late@integration.test`,
    );
    const a = await as(educatorA);
    const b = await as(educatorB);
    const s = await as(studentUser);
    await a.post(
      `${base(withA)}/${(await draftWithTree(educatorA, withA)).id}/activate`,
    );
    await b.post(
      `${base(withB)}/${(await draftWithTree(educatorB, withB)).id}/activate`,
    );
    const lateWorkout = await draftWithTree(educatorA, unlinked);
    expect(
      (await a.post(`${base(unlinked)}/${lateWorkout.id}/activate`)).status,
    ).toBe(200);

    const read = await s.get('/me/educator-workouts');
    expect(
      read.body.workouts
        .map((w: { educator: { name: string } }) => w.educator.name)
        .sort(),
    ).toEqual(['Marina Costa', 'Thiago Ramos']);

    const late = await as(secondStudentUser);
    expect(
      (await late.get('/me/educator-workouts')).body.workouts,
    ).toHaveLength(0);

    await clientsRepo.setAllClientUser(
      secondStudentUser.id,
      `${RUN_TAG}-late@integration.test`,
    );
    expect(
      (await late.get('/me/educator-workouts')).body.workouts,
    ).toHaveLength(1);
  });

  it('IT-011 notifies once per activation and at most once per 30 minutes of edits, even for simultaneous edits', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const url = `${base(studentId)}/${w.id}`;

    await a.post(`${url}/activate`);
    let notices = await notificationsOf(studentUser);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('Thiago Ramos');
    expect(notices[0].link).toBe('/restrict/workouts?plano=educador');

    await a.put(url, validTree({ title: 'Edit 1' }));
    expect(await notificationsOf(studentUser)).toHaveLength(1);

    await moveWindowBack(w.id);
    await a.put(url, validTree({ title: 'Edit 2' }));
    expect(await notificationsOf(studentUser)).toHaveLength(2);
    await a.put(url, validTree({ title: 'Edit 3' }));
    expect(await notificationsOf(studentUser)).toHaveLength(2);

    await moveWindowBack(w.id);
    const responses = await Promise.all([
      a.put(url, validTree({ title: 'Simult 1' })),
      a.put(url, validTree({ title: 'Simult 2' })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    notices = await notificationsOf(studentUser);
    expect(notices).toHaveLength(3);
  });

  it('IT-012 sends no notification for an unlinked record, for drafts, archived workouts, deactivation or duplication', async () => {
    const unlinked = await registerStudent(
      educatorA,
      `${RUN_TAG}-nolink@integration.test`,
    );
    const linked = await registerStudent(educatorA, '', studentUser);
    const a = await as(educatorA);
    const orphan = await draftWithTree(educatorA, unlinked);
    await a.post(`${base(unlinked)}/${orphan.id}/activate`);
    await a.put(`${base(unlinked)}/${orphan.id}`, validTree({ title: 'x' }));

    const draft = await draftWithTree(educatorA, linked);
    await a.put(`${base(linked)}/${draft.id}`, validTree({ title: 'y' }));
    await a.post(`${base(linked)}/${draft.id}/duplicate`, {
      studentIds: [linked],
    });
    expect(await notificationsOf(studentUser)).toHaveLength(0);

    await a.post(`${base(linked)}/${draft.id}/activate`);
    expect(await notificationsOf(studentUser)).toHaveLength(1);
    await a.post(`${base(linked)}/${draft.id}/deactivate`);
    await moveWindowBack(draft.id);
    await a.put(
      `${base(linked)}/${draft.id}`,
      validTree({ title: 'archived edit' }),
    );
    expect(await notificationsOf(studentUser)).toHaveLength(1);
  });

  it('IT-020 still records the in-app notice and sends no e-mail when the category is muted', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    await prisma.notificationPreference.create({
      data: {
        userId: studentUser.id,
        category: 'WORKOUT_PLAN',
        enabled: false,
      },
    });

    await a.post(`${base(studentId)}/${w.id}/activate`);

    expect(await notificationsOf(studentUser)).toHaveLength(1);
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('IT-013 gives the mirror a current-workout summary and the overview the current workout', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    const s = await as(studentUser);

    expect((await s.get('/me/physical-educator')).body.todayWorkout).toBeNull();
    expect(
      (await a.get(`/educator/students/${studentId}`)).body.overview
        .currentWorkout,
    ).toBeNull();

    await a.post(`${base(studentId)}/${w.id}/activate`);

    const mirror = await s.get('/me/physical-educator');
    expect(mirror.body.todayWorkout).toMatchObject({
      id: w.id,
      title: 'Hipertrofia',
      todaySessionId: null,
      sessions: [
        { label: 'A', name: 'Peito', exerciseCount: 2 },
        { label: 'B', name: 'Costas', exerciseCount: 1 },
      ],
    });
    expect((await s.get('/me/nutritionist')).body).toEqual({
      hasProfessional: false,
    });
    expect(
      (await a.get(`/educator/students/${studentId}`)).body.overview
        .currentWorkout,
    ).toMatchObject({
      id: w.id,
      sessionNames: ['Peito', 'Costas'],
    });

    await a.post(`${base(studentId)}/${w.id}/deactivate`);
    await draftWithTree(educatorA, studentId);
    expect((await s.get('/me/physical-educator')).body.todayWorkout).toBeNull();
    expect(
      (await a.get(`/educator/students/${studentId}`)).body.overview
        .currentWorkout,
    ).toBeNull();
  });

  it('IT-014 reports only the intersecting restriction, none without account or profile, and follows profile changes', async () => {
    const linked = await registerStudent(educatorA, '', studentUser);
    const unlinked = await registerStudent(
      educatorA,
      `${RUN_TAG}-c@integration.test`,
    );
    const other = await registerStudent(educatorA, '', secondStudentUser);
    const a = await as(educatorA);
    await prisma.fitnessProfile.create({
      data: { userId: studentUser.id, restrictions: ['KNEE', 'SHOULDER'] },
    });
    const tree = validTree({
      sessions: [
        {
          name: 'Pernas',
          exercises: [
            libraryItem({ exerciseId: kneeExercise.id }),
            libraryItem(),
          ],
        },
      ],
    });
    const w = await draftWithTree(educatorA, linked, tree);

    const read = await a.get(`${base(linked)}/${w.id}`);
    expect(
      read.body.sessions[0].exercises.map(
        (e: { conflicts: string[] }) => e.conflicts,
      ),
    ).toEqual([['KNEE'], []]);
    const endpoint = await a.post(`${base(linked)}/conflicts`, {
      exerciseIds: [kneeExercise.id, plainExercise.id],
    });
    expect(endpoint.body).toEqual({
      conflicts: { [kneeExercise.id]: ['KNEE'] },
    });

    const noAccount = await a.post(`${base(unlinked)}/conflicts`, {
      exerciseIds: [kneeExercise.id],
    });
    expect(noAccount.body).toEqual({ conflicts: {} });

    await prisma.fitnessProfile.update({
      where: { userId: studentUser.id },
      data: { restrictions: [] },
    });
    expect(
      (await a.get(`${base(linked)}/${w.id}`)).body.sessions[0].exercises[0]
        .conflicts,
    ).toEqual([]);

    await prisma.fitnessProfile.create({
      data: { userId: secondStudentUser.id, restrictions: ['SPINE'] },
    });
    const copy = await a.post(`${base(linked)}/${w.id}/duplicate`, {
      studentIds: [other],
    });
    const copied = await a.get(
      `${base(other)}/${copy.body.copies[0].workoutId}`,
    );
    expect(copied.body.sessions[0].exercises[0].conflicts).toEqual([]);
    await prisma.fitnessProfile.update({
      where: { userId: secondStudentUser.id },
      data: { restrictions: ['KNEE'] },
    });
    expect(
      (await a.get(`${base(other)}/${copy.body.copies[0].workoutId}`)).body
        .sessions[0].exercises[0].conflicts,
    ).toEqual(['KNEE']);
  });

  it('IT-015 keeps a workout item with its saved name after the library deletes the exercise', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const temp = await prisma.exercise.create({
      data: {
        name: `${RUN_TAG} Temporário`,
        description: 'd',
        muscleGroup: 'Ombros',
        primaryMuscles: [],
        secondaryMuscles: [],
        equipment: 'GYM',
        contraindications: [],
        videoUrl: 'https://library.test/temp',
      },
    });
    const w = await draftWithTree(
      educatorA,
      studentId,
      validTree({
        sessions: [
          { name: 'A', exercises: [libraryItem({ exerciseId: temp.id })] },
        ],
      }),
    );
    const a = await as(educatorA);
    await a.post(`${base(studentId)}/${w.id}/activate`);

    await prisma.exercise.delete({ where: { id: temp.id } });

    const item = (await a.get(`${base(studentId)}/${w.id}`)).body.sessions[0]
      .exercises[0];
    expect(item).toMatchObject({
      name: `${RUN_TAG} Temporário`,
      muscleGroup: 'Ombros',
      libraryVideoUrl: null,
      exerciseId: null,
    });
    const student = (await (await as(studentUser)).get('/me/educator-workouts'))
      .body;
    expect(student.workouts[0].workout.sessions[0].exercises[0]).toMatchObject({
      name: `${RUN_TAG} Temporário`,
      videoUrl: null,
    });
  });

  it('IT-016 refuses a pending, rejected or non-existent library exercise with 400', async () => {
    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-lib@integration.test`,
    );
    const created = await (
      await as(educatorA)
    ).post(base(studentId), { title: 'T' });
    const a = await as(educatorA);

    for (const exerciseId of [pendingExercise.id, RANDOM_UUID]) {
      const refused = await a.put(`${base(studentId)}/${created.body.id}`, {
        title: 'T',
        sessions: [{ name: 'A', exercises: [libraryItem({ exerciseId })] }],
      });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('invalid_library_exercise');
    }
    const rejected = await prisma.exercise.create({
      data: {
        name: `${RUN_TAG} Rejeitado`,
        description: 'd',
        muscleGroup: 'Peito',
        primaryMuscles: [],
        secondaryMuscles: [],
        equipment: 'GYM',
        contraindications: [],
        status: 'REJECTED',
      },
    });
    const refused = await a.put(`${base(studentId)}/${created.body.id}`, {
      title: 'T',
      sessions: [
        { name: 'A', exercises: [libraryItem({ exerciseId: rejected.id })] },
      ],
    });
    expect(refused.status).toBe(400);
  });

  it('IT-017 refuses anonymous callers, nutritionists and regular users, and serves the student read to anyone signed in', async () => {
    const urls: Array<[string, string]> = [
      ['get', base(RANDOM_UUID)],
      ['post', base(RANDOM_UUID)],
      ['get', `${base(RANDOM_UUID)}/${RANDOM_UUID}`],
      ['put', `${base(RANDOM_UUID)}/${RANDOM_UUID}`],
      ['post', `${base(RANDOM_UUID)}/${RANDOM_UUID}/activate`],
      ['post', `${base(RANDOM_UUID)}/${RANDOM_UUID}/deactivate`],
      ['delete', `${base(RANDOM_UUID)}/${RANDOM_UUID}`],
      ['post', `${base(RANDOM_UUID)}/${RANDOM_UUID}/duplicate`],
      ['post', `${base(RANDOM_UUID)}/conflicts`],
    ];
    const server = app.getHttpServer();
    const call = (method: string, url: string, auth?: string) => {
      const verb = (
        request(server) as unknown as Record<
          string,
          (u: string) => request.Test
        >
      )[method](url);
      return (auth ? verb.set('Authorization', auth) : verb).send({});
    };

    for (const [method, url] of urls) {
      expect((await call(method, url)).status).toBe(401);
    }
    for (const who of [nutritionist, regularUser]) {
      const token = await jwtService.signAsync({
        id: who.id,
        email: who.email,
      });
      for (const [method, url] of urls) {
        expect((await call(method, url, `Bearer ${token}`)).status).toBe(403);
      }
      const student = await (await as(who)).get('/me/educator-workouts');
      expect(student.status).toBe(200);
      expect(student.body).toEqual({ workouts: [] });
    }
    expect((await request(server).get('/me/educator-workouts')).status).toBe(
      401,
    );
  });

  it('IT-018 has the tables, enums, cascades, the notification category and the one-active index', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('EducatorWorkout','EducatorWorkoutSession','EducatorWorkoutExercise')`;
    expect(tables).toHaveLength(3);

    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname IN ('EducatorWorkoutStatus','EducatorExerciseSource')`;
    expect(enums).toHaveLength(2);

    const category = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'NotificationCategory' AND enumlabel = 'WORKOUT_PLAN'`;
    expect(category).toHaveLength(1);

    const index = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'EducatorWorkout_one_active_per_client'`;
    expect(index[0].indexdef).toMatch(/UNIQUE/);
    expect(index[0].indexdef).toMatch(/ACTIVE/);

    const deletes = await prisma.$queryRaw<
      Array<{ confdeltype: string; conname: string }>
    >`
      SELECT conname, confdeltype FROM pg_constraint
      WHERE conname IN ('EducatorWorkout_clientId_fkey','EducatorWorkoutSession_workoutId_fkey','EducatorWorkoutExercise_sessionId_fkey')`;
    expect(deletes).toHaveLength(3);
    expect(deletes.every((c) => c.confdeltype === 'c')).toBe(true);

    const studentId = await registerStudent(
      educatorA,
      `${RUN_TAG}-cascade@integration.test`,
    );
    const w = await draftWithTree(educatorA, studentId);
    await prisma.client.delete({ where: { id: studentId } });
    expect(await prisma.educatorWorkout.count({ where: { id: w.id } })).toBe(0);
  });

  it('IT-019 leaves the AI workout tables untouched by every educator operation', async () => {
    const studentId = await registerStudent(educatorA, '', studentUser);
    const before = await prisma.workout.count();
    const w = await draftWithTree(educatorA, studentId);
    const a = await as(educatorA);
    await a.post(`${base(studentId)}/${w.id}/activate`);
    await a.put(`${base(studentId)}/${w.id}`, validTree({ title: 'Mudou' }));
    await a.post(`${base(studentId)}/${w.id}/deactivate`);
    await a.del(`${base(studentId)}/${w.id}`);

    expect(await prisma.workout.count()).toBe(before);
    expect(
      await prisma.workoutDay.count({
        where: { workout: { userId: studentUser.id } },
      }),
    ).toBe(0);
  });
});
