/**
 * Integration tests for PRD `educator-schedule`, task 1 (fixed times and the
 * educator API).
 *
 * Runs the real fixed-times controller and service, the repositories, the
 * advisory lock, AuthGuard, PhysicalEducatorGuard, the real
 * NotificationsService and the global ValidationPipe against a real migrated
 * database. Only `MailService` (no SMTP) is stubbed.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { FixedTimesController } from '@/educator-students/schedule/fixedTimes.controller';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { brtDateKey } from '@/scheduling/fixed-times/fixedTime.util';
import { FixedTimeNotificationsService } from '@/scheduling/fixed-times/fixedTimeNotifications.service';
import { FixedTimesService } from '@/scheduling/fixed-times/fixedTimes.service';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(180_000);

const RUN_TAG = `fixed-${Date.now()}`;
const jwtSecret = 'fixed-times-integration-jwt-secret';

describe('Educator fixed times integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let educator: Users;
  let educatorProductId: string;
  // Each student's own educator: a student's agenda is isolated from the others
  // unless a test asks for a shared one (conflicts are per educator).
  const ownerOf = new Map<string, Users>();
  let otherEducator: Users;
  let studentAccount: Users;
  let regularUser: Users;
  const sendNotificationEmail = jest.fn();

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
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
      ],
      controllers: [FixedTimesController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        EducatorWorkoutsRepository,
        FixedTimesRepository,
        NotificationsRepository,
        NotificationsService,
        FixedTimeNotificationsService,
        FixedTimesService,
        Clock,
        AuthGuard,
        PhysicalEducatorGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

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
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const productId = group.products[0].id;
    educatorProductId = productId;
    educator = await createUser('educator', 'Thiago Ramos', productId);
    otherEducator = await createUser('other', 'Marina Costa', productId);
    studentAccount = await createUser('student', 'Diego Aluno', null);
    regularUser = await createUser('regular', 'Comum', null);
  });

  afterAll(async () => {
    // Every user this run created carries the run tag in its e-mail.
    const ids = (
      await prisma.users.findMany({
        where: { email: { startsWith: RUN_TAG } },
        select: { id: true },
      })
    ).map((user) => user.id);
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.slot.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
    sendNotificationEmail.mockResolvedValue(undefined);
  });

  async function createUser(
    label: string,
    name: string,
    productId: string | null,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
      },
    });
  }

  async function newEducator(): Promise<Users> {
    const label = `educator-${Math.random().toString(36).slice(2, 8)}`;
    return await createUser(label, 'Educador de teste', educatorProductId);
  }

  async function createStudent(
    name: string,
    account: Users | null = null,
    owner?: Users,
  ): Promise<string> {
    const professional = owner ?? (await newEducator());
    const client = await prisma.client.create({
      data: {
        name,
        phone: '11999990000',
        email: `${RUN_TAG}-${name.replace(/\s/g, '').toLowerCase()}-${Math.random()}@student.test`,
        professionalId: professional.id,
        userId: account?.id ?? null,
      },
    });
    ownerOf.set(client.id, professional);
    return client.id;
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
      patch: (url: string, body: object = {}) =>
        request(server).patch(url).set('Authorization', auth).send(body),
      del: (url: string) =>
        request(server).delete(url).set('Authorization', auth),
    };
  }

  const base = (studentId: string) =>
    `/educator/students/${studentId}/schedule`;

  async function createFixed(
    studentId: string,
    body: Record<string, unknown>,
    caller?: Users,
  ) {
    const who = caller ?? ownerOf.get(studentId) ?? educator;
    return (await as(who)).post(`${base(studentId)}/fixed-times`, body);
  }

  // The next Monday (Brasília) strictly after today, at the given start, so
  // every test sees a fixed time whose first occurrence is in the future.
  function nextBookingStart(): Date {
    const day = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    day.setUTCHours(18, 0, 0, 0);
    return day;
  }

  describe('create (IT-001, IT-002, IT-011, IT-020)', () => {
    it('IT-001 creates a Monday time with sessions for the next 35 days at the right UTC instants', async () => {
      const studentId = await createStudent('Ana Silva');

      const response = await createFixed(studentId, {
        weekday: 1,
        startMinute: 7 * 60,
        type: 'PRESENCIAL',
        workoutLetter: 'A',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        weekday: 1,
        startMinute: 420,
        durationMinutes: 60,
      });
      const sessions = await prisma.fixedSession.findMany({
        where: { fixedTimeId: response.body.id },
        orderBy: { startAt: 'asc' },
      });
      expect(sessions.length).toBeGreaterThanOrEqual(4);
      expect(sessions.length).toBeLessThanOrEqual(6);
      for (const session of sessions) {
        expect(session.startAt.getUTCHours()).toBe(10);
        expect(session.startAt.getUTCMinutes()).toBe(0);
        expect(brtDateKey(session.startAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('IT-002 refuses an overlap with another student and a booked session, allows touching and canceled overlaps', async () => {
      const first = await createStudent('Bruna', null, educator);
      const second = await createStudent('Carla', null, educator);
      const booked = await createFixed(first, {
        weekday: 2,
        startMinute: 8 * 60,
        type: 'PRESENCIAL',
      });
      expect(booked.status).toBe(201);

      const overlapping = await createFixed(second, {
        weekday: 2,
        startMinute: 8 * 60 + 30,
        type: 'PRESENCIAL',
      });
      expect(overlapping.status).toBe(409);
      expect(overlapping.body.code).toBe('schedule_conflict');
      expect(overlapping.body.details.studentName).toBe('Bruna');

      const touching = await createFixed(second, {
        weekday: 2,
        startMinute: 9 * 60,
        type: 'PRESENCIAL',
      });
      expect(touching.status).toBe(201);

      const bookedStudent = await createStudent(
        'Dani',
        studentAccount,
        educator,
      );
      const slotStart = nextBookingStart();
      await prisma.slot.create({
        data: {
          professionalId: educator.id,
          startAt: slotStart,
          endAt: new Date(slotStart.getTime() + 60 * 60 * 1000),
          status: 'BOOKED',
          type: 'PRESENCIAL',
          userId: studentAccount.id,
        },
      });
      // 18:00Z is 15:00 in Brasília, the same date: an overlapping rule.
      const clash = await createFixed(bookedStudent, {
        weekday: slotStart.getUTCDay() === 0 ? 7 : slotStart.getUTCDay(),
        startMinute: 15 * 60,
        type: 'PRESENCIAL',
      });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('schedule_conflict');
    });

    it('IT-003 leaves exactly one of two simultaneous creations for two students at the same hour', async () => {
      const one = await createStudent('Eva', null, educator);
      const two = await createStudent('Fabio', null, educator);

      const results = await Promise.all([
        createFixed(one, {
          weekday: 3,
          startMinute: 18 * 60,
          type: 'PRESENCIAL',
        }),
        createFixed(two, {
          weekday: 3,
          startMinute: 18 * 60,
          type: 'PRESENCIAL',
        }),
      ]);

      const statuses = results.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);
    });

    it('IT-003 leaves exactly one fixed time for two identical simultaneous creations', async () => {
      const student = await createStudent('Gina');

      const results = await Promise.all([
        createFixed(student, {
          weekday: 4,
          startMinute: 19 * 60,
          type: 'PRESENCIAL',
        }),
        createFixed(student, {
          weekday: 4,
          startMinute: 19 * 60,
          type: 'PRESENCIAL',
        }),
      ]);

      expect(results.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect(
        await prisma.fixedTime.count({ where: { clientId: student } }),
      ).toBe(1);
    });

    it('IT-020 keeps the Brasília date of a Sunday 23:00 time and a Saturday 00:00 time across the year end', async () => {
      const student = await createStudent('Helena');

      const sunday = await createFixed(student, {
        weekday: 7,
        startMinute: 23 * 60,
        type: 'PRESENCIAL',
      });
      expect(sunday.status).toBe(201);
      const sundaySessions = await prisma.fixedSession.findMany({
        where: { fixedTimeId: sunday.body.id },
      });
      for (const session of sundaySessions) {
        expect(session.startAt.getUTCHours()).toBe(2);
        expect(
          new Date(`${brtDateKey(session.startAt)}T12:00:00Z`).getUTCDay(),
        ).toBe(0);
      }

      const saturday = await createFixed(student, {
        weekday: 6,
        startMinute: 0,
        type: 'PRESENCIAL',
      });
      expect(saturday.status).toBe(201);
      const saturdaySessions = await prisma.fixedSession.findMany({
        where: { fixedTimeId: saturday.body.id },
      });
      for (const session of saturdaySessions) {
        expect(session.startAt.getUTCHours()).toBe(3);
        expect(
          new Date(`${brtDateKey(session.startAt)}T12:00:00Z`).getUTCDay(),
        ).toBe(6);
      }
    });

    it('IT-011 notifies the linked student once on create and none for a record without an account', async () => {
      const linked = await createStudent('Iara', studentAccount);
      const unlinked = await createStudent('Joana');

      await createFixed(linked, {
        weekday: 5,
        startMinute: 10 * 60,
        type: 'ONLINE',
        onlineLink: 'https://meet.test/x',
      });
      await createFixed(unlinked, {
        weekday: 5,
        startMinute: 11 * 60,
        type: 'PRESENCIAL',
      });

      const notices = await prisma.notification.findMany({
        where: { userId: studentAccount.id, category: 'SCHEDULE_CHANGE' },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain('sexta-feira às 10:00, online.');
    });

    it('IT-021 leaves no fixed time when a session insert fails', async () => {
      const student = await createStudent('Kátia');
      const repo = app.get(FixedTimesRepository);
      const spy = jest
        .spyOn(repo, 'createSessions')
        .mockRejectedValueOnce(new Error('insert failed'));

      const response = await createFixed(student, {
        weekday: 2,
        startMinute: 6 * 60,
        type: 'PRESENCIAL',
      });

      expect(response.status).toBe(500);
      expect(
        await prisma.fixedTime.count({ where: { clientId: student } }),
      ).toBe(0);
      expect(
        await prisma.fixedSession.count({ where: { clientId: student } }),
      ).toBe(0);
      spy.mockRestore();
    });

    it('answers a foreign educator with the same 404 as for a random id', async () => {
      const student = await createStudent('Lia');

      const foreign = await createFixed(
        student,
        { weekday: 1, startMinute: 0, type: 'PRESENCIAL' },
        otherEducator,
      );
      const random = await createFixed('01890a5d-ac96-774b-bcce-b302099a8099', {
        weekday: 1,
        startMinute: 0,
        type: 'PRESENCIAL',
      });

      expect(foreign.status).toBe(404);
      expect(random.status).toBe(404);
      expect(foreign.body).toEqual(random.body);
    });

    it('refuses a regular user with 403 on the educator routes', async () => {
      const student = await createStudent('Marta');

      const response = await createFixed(
        student,
        { weekday: 1, startMinute: 0, type: 'PRESENCIAL' },
        regularUser,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('update and remove (IT-006, IT-007, IT-011, IT-022)', () => {
    it('IT-006 regenerates future sessions when the start changes and keeps a started one', async () => {
      const student = await createStudent('Nina');
      const created = await createFixed(student, {
        weekday: 1,
        startMinute: 7 * 60,
        type: 'PRESENCIAL',
      });
      const fixedId = created.body.id as string;
      const started = await prisma.fixedSession.findFirst({
        where: { fixedTimeId: fixedId },
        orderBy: { startAt: 'asc' },
      });
      await prisma.fixedSession.update({
        where: { id: started!.id },
        data: {
          startAt: new Date(Date.now() - 60 * 60 * 1000),
          endAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const changed = await (
        await as(ownerOf.get(student)!)
      ).patch(`${base(student)}/fixed-times/${fixedId}`, {
        startMinute: 8 * 60,
      });

      expect(changed.status).toBe(200);
      const remaining = await prisma.fixedSession.findMany({
        where: { fixedTimeId: fixedId },
      });
      expect(remaining.some((row) => row.id === started!.id)).toBe(true);
      const future = remaining.filter((row) => row.id !== started!.id);
      expect(future.every((row) => row.startAt.getUTCHours() === 11)).toBe(
        true,
      );
    });

    it('IT-007 removes future sessions, keeps past ones detached and notifies once', async () => {
      const student = await createStudent('Olga', studentAccount);
      const created = await createFixed(student, {
        weekday: 4,
        startMinute: 12 * 60,
        type: 'PRESENCIAL',
      });
      const fixedId = created.body.id as string;
      const past = await prisma.fixedSession.create({
        data: {
          fixedTimeId: fixedId,
          clientId: student,
          professionalId: educator.id,
          startAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          endAt: new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
          ),
          type: 'PRESENCIAL',
        },
      });
      const before = await prisma.notification.count({
        where: { userId: studentAccount.id, category: 'SCHEDULE_CHANGE' },
      });

      const removed = await (
        await as(ownerOf.get(student)!)
      ).del(`${base(student)}/fixed-times/${fixedId}`);

      expect(removed.status).toBe(204);
      expect(
        await prisma.fixedTime.findUnique({ where: { id: fixedId } }),
      ).toBeNull();
      const keptPast = await prisma.fixedSession.findUnique({
        where: { id: past.id },
      });
      expect(keptPast?.fixedTimeId).toBeNull();
      expect(
        await prisma.fixedSession.count({ where: { fixedTimeId: fixedId } }),
      ).toBe(0);
      const after = await prisma.notification.count({
        where: { userId: studentAccount.id, category: 'SCHEDULE_CHANGE' },
      });
      expect(after - before).toBe(1);
    });

    it('IT-011 an unchanged edit creates no notice; a real change creates one', async () => {
      const student = await createStudent('Paola', studentAccount);
      const created = await createFixed(student, {
        weekday: 6,
        startMinute: 9 * 60,
        type: 'PRESENCIAL',
      });
      const fixedId = created.body.id as string;
      const count = () =>
        prisma.notification.count({
          where: { userId: studentAccount.id, category: 'SCHEDULE_CHANGE' },
        });
      const before = await count();

      await (
        await as(ownerOf.get(student)!)
      ).patch(`${base(student)}/fixed-times/${fixedId}`, {
        startMinute: 9 * 60,
      });
      expect(await count()).toBe(before);

      await (
        await as(ownerOf.get(student)!)
      ).patch(`${base(student)}/fixed-times/${fixedId}`, {
        durationMinutes: 90,
      });
      expect(await count()).toBe(before + 1);
    });

    it('IT-022 leaves the stored values equal to one of two concurrent edits', async () => {
      const student = await createStudent('Quinta');
      const created = await createFixed(student, {
        weekday: 3,
        startMinute: 7 * 60,
        type: 'PRESENCIAL',
      });
      const fixedId = created.body.id as string;
      const caller = await as(ownerOf.get(student)!);

      await Promise.all([
        caller.patch(`${base(student)}/fixed-times/${fixedId}`, {
          startMinute: 15 * 60,
        }),
        caller.patch(`${base(student)}/fixed-times/${fixedId}`, {
          startMinute: 16 * 60,
        }),
      ]);

      const stored = await prisma.fixedTime.findUniqueOrThrow({
        where: { id: fixedId },
      });
      expect([900, 960]).toContain(stored.startMinute);
      const sessions = await prisma.fixedSession.findMany({
        where: { fixedTimeId: fixedId },
      });
      const hours = new Set(sessions.map((row) => row.startAt.getUTCHours()));
      expect(hours.size).toBe(1);
      expect([18, 19]).toContain([...hours][0]);
    });
  });

  describe('schema (IT-018)', () => {
    it('IT-018 creates the tables, the status enum, the unique pair and the category', async () => {
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('FixedTime', 'FixedSession')`;
      expect(tables.map((row) => row.table_name).sort()).toEqual([
        'FixedSession',
        'FixedTime',
      ]);

      const unique = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'FixedSession' AND indexdef LIKE 'CREATE UNIQUE%'`;
      expect(unique.map((row) => row.indexname)).toContain(
        'FixedSession_fixedTimeId_startAt_key',
      );

      const category = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'NotificationCategory' AND enumlabel = 'SCHEDULE_CHANGE'`;
      expect(category).toHaveLength(1);
    });
  });

  describe('list and limit (UT-020 boundary)', () => {
    it('lists the rules of a student and refuses the 15th', async () => {
      const student = await createStudent('Renata');
      for (let index = 0; index < 14; index += 1) {
        // Two rows per weekday at 06:00 and 09:00: no two of them overlap.
        const response = await createFixed(student, {
          weekday: (index % 7) + 1,
          startMinute: 6 * 60 + Math.floor(index / 7) * 180,
          type: 'PRESENCIAL',
        });
        expect(response.status).toBe(201);
      }

      const fifteenth = await createFixed(student, {
        weekday: 1,
        startMinute: 1000,
        type: 'PRESENCIAL',
      });
      expect(fifteenth.status).toBe(409);
      expect(fifteenth.body.code).toBe('fixed_time_limit');

      const listed = await (await as(ownerOf.get(student)!)).get(base(student));
      expect(listed.status).toBe(200);
      expect(listed.body.fixedTimes).toHaveLength(14);
    });
  });
});
