/**
 * Integration tests for PRD `educator-schedule`, task 2: fixed sessions in the
 * Agenda (booking lock, slot hiding, single-date cancellation, E1 list order).
 *
 * Runs the real booking, fixed-sessions and fixed-times controllers and their
 * services and repositories, the advisory lock and the E1 students list
 * against a real migrated database. Only `MailService` is stubbed.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { FixedTimesController } from '@/educator-students/schedule/fixedTimes.controller';
import { AccountLookupThrottlerGuard } from '@/educator-students/students/accountLookupThrottler.guard';
import { StudentsController } from '@/educator-students/students/students.controller';
import { StudentsService } from '@/educator-students/students/students.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { SchedulingRepository } from '@/repositories/scheduling/scheduling.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { BookingController } from '@/scheduling/booking.controller';
import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsController } from '@/scheduling/fixed-times/fixedSessions.controller';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { FixedTimeNotificationsService } from '@/scheduling/fixed-times/fixedTimeNotifications.service';
import { FixedTimesService } from '@/scheduling/fixed-times/fixedTimes.service';
import { SchedulingService } from '@/scheduling/scheduling.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(240_000);

const RUN_TAG = `fixsch-${Date.now()}`;
const jwtSecret = 'fixed-schedule-integration-jwt-secret';
const DAY = 24 * 60 * 60 * 1000;

// The next Friday strictly after 14 days from now, 15:00 in Brasília (18:00Z).
function futureFriday(offsetDays: number, hourUtc = 18): Date {
  const day = new Date(Date.now() + offsetDays * DAY);
  const friday = new Date(day);
  friday.setUTCDate(day.getUTCDate() + ((5 - day.getUTCDay() + 7) % 7 || 7));
  friday.setUTCHours(hourUtc, 0, 0, 0);
  return friday;
}

describe('Fixed sessions in the Agenda (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let educator: Users;
  let studentAccount: Users;
  let otherAccount: Users;
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
      controllers: [
        BookingController,
        FixedSessionsController,
        FixedTimesController,
        StudentsController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        SchedulingRepository,
        FixedTimesRepository,
        EducatorWorkoutsRepository,
        PhysicalAssessmentsRepository,
        NotificationsRepository,
        NotificationsService,
        FixedTimeNotificationsService,
        FixedTimesService,
        FixedSessionsService,
        SchedulingService,
        StudentsService,
        Clock,
        AuthGuard,
        PhysicalEducatorGuard,
        ProfessionalGuard,
        AccountLookupThrottlerGuard,
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
    educator = await createUser(
      'educator',
      'Thiago Ramos',
      group.products[0].id,
    );
    studentAccount = await createUser('student', 'Diego Aluno', null);
    otherAccount = await createUser('other', 'Paula Aluna', null);
  });

  afterAll(async () => {
    const tagged = { email: { startsWith: RUN_TAG } };
    const ids = (
      await prisma.users.findMany({ where: tagged, select: { id: true } })
    ).map((u) => u.id);
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.slot.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(
    label: string,
    name: string,
    productId: string | null,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name,
        email: `${RUN_TAG}-${label}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId,
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
      patch: (url: string, body: object = {}) =>
        request(server).patch(url).set('Authorization', auth).send(body),
    };
  }

  // A student record of the educator, linked to an account when given.
  async function createStudent(
    name: string,
    account: Users | null,
  ): Promise<string> {
    const client = await prisma.client.create({
      data: {
        name,
        phone: '11999990000',
        email: `${RUN_TAG}-${name.replace(/\s/g, '').toLowerCase()}-${Math.random()}@student.test`,
        professionalId: educator.id,
        userId: account?.id ?? null,
      },
    });
    return client.id;
  }

  async function openSlot(startAt: Date): Promise<string> {
    const slot = await prisma.slot.create({
      data: {
        professionalId: educator.id,
        startAt,
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        status: 'OPEN',
      },
    });
    return slot.id;
  }

  describe('booking lock and hiding (IT-004, IT-005)', () => {
    it('IT-004 a simultaneous booking and fixed-time creation never both succeed', async () => {
      const start = futureFriday(14);
      const slotId = await openSlot(start);
      const client = await createStudent('Racer Student', null);
      const weekday = 5;
      const educatorCaller = await as(educator);
      const studentCaller = await as(studentAccount);

      const [booking, fixed] = await Promise.all([
        studentCaller.post(`/scheduling/slots/${slotId}/book`, {
          type: 'PRESENCIAL',
        }),
        educatorCaller.post(
          `/educator/students/${client}/schedule/fixed-times`,
          {
            weekday,
            startMinute: 15 * 60,
            type: 'PRESENCIAL',
          },
        ),
      ]);

      const bookedOk = [200, 201].includes(booking.status);
      const fixedOk = fixed.status === 201;
      expect(bookedOk && fixedOk).toBe(false);
      expect(bookedOk || fixedOk).toBe(true);
    });

    it('IT-005 an open slot covered by a fixed session is hidden, and reappears when the date is canceled', async () => {
      // 19:00 Brasília: a time of its own, so IT-004's Friday 15:00 rule does not conflict.
      const start = futureFriday(21, 22);
      const slotId = await openSlot(start);
      const client = await createStudent('Hidden Student', studentAccount);
      const educatorCaller = await as(educator);
      const created = await educatorCaller.post(
        `/educator/students/${client}/schedule/fixed-times`,
        {
          weekday: 5,
          startMinute: 19 * 60,
          type: 'PRESENCIAL',
        },
      );
      expect(created.status).toBe(201);

      const listing = async () => {
        const from = new Date(start.getTime() - DAY).toISOString();
        const to = new Date(start.getTime() + DAY).toISOString();
        const response = await (
          await as(studentAccount)
        ).get(
          `/scheduling/slots?professionalId=${educator.id}&from=${from}&to=${to}`,
        );
        return (response.body as Array<{ id: string }>).map((slot) => slot.id);
      };
      expect(await listing()).not.toContain(slotId);

      const session = await prisma.fixedSession.findFirst({
        where: { fixedTimeId: created.body.id, startAt: start },
      });
      expect(session).not.toBeNull();
      const canceled = await (
        await as(studentAccount)
      ).post(`/scheduling/fixed-sessions/${session!.id}/cancel`);
      expect(canceled.status).toBe(204);

      expect(await listing()).toContain(slotId);
    });
  });

  describe('single-date cancellation (IT-008)', () => {
    it('IT-008 each side cancels a date, the other side is told, and a second cancel answers 409', async () => {
      const client = await createStudent('Cancel Student', studentAccount);
      const created = await (
        await as(educator)
      ).post(`/educator/students/${client}/schedule/fixed-times`, {
        weekday: 2,
        startMinute: 9 * 60,
        type: 'PRESENCIAL',
      });
      expect(created.status).toBe(201);
      const sessions = await prisma.fixedSession.findMany({
        where: { fixedTimeId: created.body.id },
        orderBy: { startAt: 'asc' },
      });
      const [byStudent, byEducator] = [sessions[0], sessions[1]];

      const beforeEducator = await prisma.notification.count({
        where: { userId: educator.id },
      });
      const beforeStudent = await prisma.notification.count({
        where: { userId: studentAccount.id },
      });

      const studentCancel = await (
        await as(studentAccount)
      ).post(`/scheduling/fixed-sessions/${byStudent.id}/cancel`);
      const educatorCancel = await (
        await as(educator)
      ).post(`/scheduling/fixed-sessions/${byEducator.id}/cancel`);
      const again = await (
        await as(educator)
      ).post(`/scheduling/fixed-sessions/${byStudent.id}/cancel`);

      expect(studentCancel.status).toBe(204);
      expect(educatorCancel.status).toBe(204);
      expect(again.status).toBe(409);
      expect(
        await prisma.notification.count({ where: { userId: educator.id } }),
      ).toBe(beforeEducator + 1);
      expect(
        await prisma.notification.count({
          where: { userId: studentAccount.id },
        }),
      ).toBe(beforeStudent + 1);
    });

    it('IT-008 a stranger gets the same 404 as for a random id', async () => {
      const client = await createStudent('Stranger Student', null);
      const created = await (
        await as(educator)
      ).post(`/educator/students/${client}/schedule/fixed-times`, {
        weekday: 3,
        startMinute: 9 * 60,
        type: 'PRESENCIAL',
      });
      const session = await prisma.fixedSession.findFirst({
        where: { fixedTimeId: created.body.id },
      });

      const foreign = await (
        await as(otherAccount)
      ).post(`/scheduling/fixed-sessions/${session!.id}/cancel`);
      const random = await (
        await as(otherAccount)
      ).post(
        `/scheduling/fixed-sessions/01890a5d-ac96-774b-bcce-b302099a8099/cancel`,
      );

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(random.body);
    });
  });

  describe('student list order (IT-015)', () => {
    it('IT-015 orders the list by the next session, students without one after, and switches to name order', async () => {
      const early = await createStudent('Ordem Zeta', null);
      const late = await createStudent('Ordem Alfa', null);
      const none = await createStudent('Ordem Beta', null);
      const caller = await as(educator);
      await caller.post(`/educator/students/${late}/schedule/fixed-times`, {
        weekday: 6,
        startMinute: 18 * 60,
        type: 'PRESENCIAL',
      });
      await caller.post(`/educator/students/${early}/schedule/fixed-times`, {
        weekday: 1,
        startMinute: 7 * 60,
        type: 'PRESENCIAL',
      });

      const byNext = await caller.get('/educator/students?search=Ordem');
      const names = (byNext.body.items as Array<{ name: string }>).map(
        (item) => item.name,
      );
      // Order follows each student's actual next session, whatever today is.
      expect(names).toHaveLength(3);
      const dated = byNext.body.items.filter(
        (item: { nextSession: unknown }) => item.nextSession !== null,
      );
      expect(dated.map((item: { name: string }) => item.name).sort()).toEqual([
        'Ordem Alfa',
        'Ordem Zeta',
      ]);
      const times = dated.map((item: { nextSession: { startAt: string } }) =>
        Date.parse(item.nextSession.startAt),
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(byNext.body.items[2].name).toBe('Ordem Beta');
      expect(byNext.body.items[2].nextSession).toBeNull();

      const byName = await caller.get(
        '/educator/students?search=Ordem&order=name',
      );
      expect(
        (byName.body.items as Array<{ name: string }>).map((item) => item.name),
      ).toEqual(['Ordem Alfa', 'Ordem Beta', 'Ordem Zeta']);
      expect(none).toBeDefined();
    });
  });
});
