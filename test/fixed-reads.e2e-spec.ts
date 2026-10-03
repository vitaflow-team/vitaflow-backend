/**
 * Integration tests for PRD `educator-schedule`, task 2: renewal, reminders,
 * student-facing reads, removal cascade and role access for fixed times.
 *
 * Runs the real feature modules against a real migrated database. The clock
 * is controlled so renewal and reminders happen at fixed Brasília instants.
 * Only `MailService` is stubbed.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { EducatorStudentsModule } from '@/educator-students/educatorStudents.module';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { ProfessionalMirrorModule } from '@/professional-mirror/professionalMirror.module';
import { Clock } from '@/scheduling/clock.service';
import { FixedSessionReminderCron } from '@/scheduling/fixed-times/fixedSessionReminder.cron';
import { FixedSessionsRenewalService } from '@/scheduling/fixed-times/fixedSessionsRenewal.service';
import { SchedulingModule } from '@/scheduling/scheduling.module';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationCategory, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(240_000);

const RUN_TAG = `fixrd-${Date.now()}`;
const jwtSecret = 'fixed-reads-integration-jwt-secret';

// Brasília wall-clock time (UTC−3, no DST) as an absolute instant.
function brt(month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, month - 1, day, hour + 3, minute));
}

describe('Fixed times: renewal, reminders, reads and access (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let clock: { at: Date };
  let renewal: FixedSessionsRenewalService;
  let reminders: FixedSessionReminderCron;
  let groupId: string;
  let educator: Users;
  let educatorTwo: Users;
  let nutritionist: Users;
  let regularUser: Users;
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
    clock = { at: brt(10, 7, 10) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: jwtSecret }),
        SchedulingModule,
        EducatorStudentsModule,
        ProfessionalMirrorModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(clock.at) })
      .overrideProvider(MailService)
      .useValue({ sendNotificationEmail })
      .compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    renewal = moduleFixture.get(FixedSessionsRenewalService);
    reminders = moduleFixture.get(FixedSessionReminderCron);

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
              name: `${RUN_TAG} educator two`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} nutritionist`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
            { name: `${RUN_TAG} user`, price: 10, type: ProductType.USER },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const product = (type: ProductType) =>
      group.products.find((p) => p.type === type)!.id;
    educator = await createUser(
      'educator',
      'Thiago Ramos',
      product(ProductType.PHYSICAL_EDUCATOR),
    );
    educatorTwo = await createUser(
      'educator2',
      'Carla Lima',
      product(ProductType.PHYSICAL_EDUCATOR),
    );
    nutritionist = await createUser(
      'nutri',
      'Marina Souza',
      product(ProductType.NUTRITIONIST),
    );
    regularUser = await createUser(
      'user',
      'Rafael Dias',
      product(ProductType.USER),
    );
    studentAccount = await createUser('student', 'Diego Aluno', null);
    otherAccount = await createUser('other', 'Paula Aluna', null);
  });

  afterAll(async () => {
    const ids = (
      await prisma.users.findMany({
        where: { email: { startsWith: RUN_TAG } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.client.deleteMany({
      where: { OR: [{ professionalId: { in: ids } }, { userId: { in: ids } }] },
    });
    await prisma.slot.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.notificationPreference.deleteMany({
      where: { userId: { in: ids } },
    });
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
  ) {
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
    const token = await jwtService.signAsync(
      { id: target.id, email: target.email },
      { secret: jwtSecret },
    );
    const auth = `Bearer ${token}`;
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

  function anonymous() {
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url),
      post: (url: string) => request(server).post(url).send({}),
      patch: (url: string) => request(server).patch(url).send({}),
      delete: (url: string) => request(server).delete(url),
    };
  }

  async function createStudent(
    name: string,
    account: Users | null,
    owner: Users = educator,
  ): Promise<string> {
    const client = await prisma.client.create({
      data: {
        name,
        phone: '11999990000',
        email: `${RUN_TAG}-${name.replace(/\s/g, '').toLowerCase()}-${Math.random()}@student.test`,
        professionalId: owner.id,
        userId: account?.id ?? null,
      },
    });
    return client.id;
  }

  async function createRule(
    caller: Users,
    clientId: string,
    body: Record<string, unknown>,
  ) {
    return await (
      await as(caller)
    ).post(`/educator/students/${clientId}/schedule/fixed-times`, {
      type: 'PRESENCIAL',
      ...body,
    });
  }

  async function createWorkout(
    clientId: string,
    status: 'ACTIVE' | 'DRAFT',
    sessionNames: string[],
  ) {
    return await prisma.educatorWorkout.create({
      data: {
        clientId,
        title: 'Hipertrofia',
        status,
        sessions: {
          create: sessionNames.map((name, position) => ({
            position,
            name,
            exercises: {
              create: [
                {
                  position: 0,
                  source: 'FREE',
                  name: 'Supino',
                  muscleGroup: 'Peito',
                  sets: 3,
                  reps: '10',
                  load: null,
                  videoUrl: null,
                },
              ],
            },
          })),
        },
      },
    });
  }

  async function sessionAt(fixedTimeId: string, startAt: Date) {
    return await prisma.fixedSession.findFirst({
      where: { fixedTimeId, startAt },
    });
  }

  async function countNotifications(
    userId: string,
    category: NotificationCategory,
  ) {
    return await prisma.notification.count({ where: { userId, category } });
  }

  describe('renewal (IT-009)', () => {
    it('extends fixed times after the clock moves a week, skips canceled and overlapping dates, and is idempotent', async () => {
      clock.at = brt(10, 6, 10);
      const ruleA = await createRule(
        educator,
        await createStudent('Renew Booked', studentAccount),
        {
          weekday: 2,
          startMinute: 9 * 60,
        },
      );
      const ruleB = await createRule(
        educator,
        await createStudent('Renew Plain', null),
        {
          weekday: 2,
          startMinute: 8 * 60,
        },
      );
      expect(ruleA.status).toBe(201);
      expect(ruleB.status).toBe(201);

      const canceledSession = await sessionAt(ruleA.body.id, brt(10, 20, 9));
      const cancel = await (
        await as(educator)
      ).post(`/scheduling/fixed-sessions/${canceledSession!.id}/cancel`);
      expect(cancel.status).toBe(204);

      await prisma.slot.create({
        data: {
          professionalId: educator.id,
          startAt: brt(11, 17, 9),
          endAt: brt(11, 17, 10),
          status: 'BOOKED',
          userId: otherAccount.id,
        },
      });

      clock.at = brt(10, 13, 10);
      const summary = await renewal.runRenewal();
      expect(summary.conflicts).toBeGreaterThanOrEqual(1);

      expect(
        await prisma.fixedSession.count({
          where: { fixedTimeId: ruleB.body.id, startAt: brt(11, 17, 8) },
        }),
      ).toBe(1);
      expect(
        await prisma.fixedSession.count({
          where: { fixedTimeId: ruleA.body.id, startAt: brt(11, 17, 9) },
        }),
      ).toBe(0);
      const kept = await sessionAt(ruleA.body.id, brt(10, 20, 9));
      expect(kept?.status).toBe('CANCELED');

      const before = await prisma.fixedSession.count({
        where: { fixedTimeId: ruleB.body.id },
      });
      await renewal.runRenewal();
      expect(
        await prisma.fixedSession.count({
          where: { fixedTimeId: ruleB.body.id },
        }),
      ).toBe(before);
    });
  });

  describe('reminders (IT-010)', () => {
    it('reminds each side once an hour before, names the linked session, skips canceled dates and muted e-mail', async () => {
      const client = await createStudent('Remind Student', studentAccount);
      await createWorkout(client, 'ACTIVE', ['Peito', 'Costas']);
      clock.at = brt(10, 22, 8);
      const rule = await createRule(educator, client, {
        weekday: 4,
        startMinute: 9 * 60,
        workoutLetter: 'A',
      });
      expect(rule.status).toBe(201);
      const cancel = await (
        await as(educator)
      ).post(
        `/scheduling/fixed-sessions/${(await sessionAt(rule.body.id, brt(10, 29, 9)))!.id}/cancel`,
      );
      expect(cancel.status).toBe(204);

      const studentBefore = await countNotifications(
        studentAccount.id,
        'CONSULTATION_REMINDER',
      );
      const educatorBefore = await countNotifications(
        educator.id,
        'CONSULTATION_REMINDER',
      );
      await reminders.sendDueFixedReminders();
      expect(
        await countNotifications(studentAccount.id, 'CONSULTATION_REMINDER'),
      ).toBe(studentBefore + 1);
      expect(
        await countNotifications(educator.id, 'CONSULTATION_REMINDER'),
      ).toBe(educatorBefore + 1);
      const sent = await prisma.notification.findFirst({
        where: { userId: studentAccount.id, category: 'CONSULTATION_REMINDER' },
        orderBy: { createdAt: 'desc' },
      });
      expect(sent?.message).toContain('Peito');

      await reminders.sendDueFixedReminders();
      expect(
        await countNotifications(studentAccount.id, 'CONSULTATION_REMINDER'),
      ).toBe(studentBefore + 1);

      clock.at = brt(10, 29, 8);
      await reminders.sendDueFixedReminders();
      expect(
        await countNotifications(studentAccount.id, 'CONSULTATION_REMINDER'),
      ).toBe(studentBefore + 1);
      expect(
        await countNotifications(educator.id, 'CONSULTATION_REMINDER'),
      ).toBe(educatorBefore + 1);
    });

    it('reminds only the educator for a record without an account', async () => {
      const client = await createStudent('Remind Offline', null);
      clock.at = brt(10, 22, 8);
      const rule = await createRule(educator, client, {
        weekday: 5,
        startMinute: 9 * 60,
      });
      expect(rule.status).toBe(201);

      clock.at = brt(10, 23, 8);
      const educatorBefore = await countNotifications(
        educator.id,
        'CONSULTATION_REMINDER',
      );
      await reminders.sendDueFixedReminders();
      expect(
        await countNotifications(educator.id, 'CONSULTATION_REMINDER'),
      ).toBe(educatorBefore + 1);
    });

    it('records the in-app reminder for a muted category but sends no e-mail', async () => {
      clock.at = brt(11, 5, 8);
      await prisma.notificationPreference.create({
        data: {
          userId: studentAccount.id,
          category: 'CONSULTATION_REMINDER',
          enabled: false,
        },
      });
      sendNotificationEmail.mockClear();
      const studentBefore = await countNotifications(
        studentAccount.id,
        'CONSULTATION_REMINDER',
      );

      await reminders.sendDueFixedReminders();

      expect(
        await countNotifications(studentAccount.id, 'CONSULTATION_REMINDER'),
      ).toBe(studentBefore + 1);
      const emailedStudent = sendNotificationEmail.mock.calls.some(
        (call) => call[1] === studentAccount.email,
      );
      expect(emailedStudent).toBe(false);
    });
  });

  describe('student reads (IT-014, IT-013)', () => {
    let linkedClient: string;
    let todaySession: { id: string } | null;

    it("IT-014 returns today's session id for the workout that has a session today", async () => {
      clock.at = brt(10, 7, 10);
      linkedClient = await createStudent('Read Student', studentAccount);
      await createWorkout(linkedClient, 'ACTIVE', ['Peito', 'Costas']);
      const rule = await createRule(educator, linkedClient, {
        weekday: 3,
        startMinute: 15 * 60,
        workoutLetter: 'B',
      });
      expect(rule.status).toBe(201);
      todaySession = await sessionAt(rule.body.id, brt(10, 7, 15));
      expect(todaySession).not.toBeNull();

      const response = await (
        await as(studentAccount)
      ).get('/me/educator-workouts');
      expect(response.status).toBe(200);
      expect(response.body.workouts[0].todaySessionId).toBe(todaySession!.id);
    });

    it("IT-013 mirrors the next time and today's session, and letters resolve against a newly activated workout", async () => {
      const mirror = await (
        await as(studentAccount)
      ).get('/me/physical-educator');
      expect(mirror.status).toBe(200);
      expect(mirror.body.nextSchedule).not.toBeNull();
      expect(mirror.body.todayWorkout.todaySessionId).toBe(todaySession!.id);

      const draft = await createWorkout(linkedClient, 'DRAFT', ['Pernas']);
      const activated = await (
        await as(educator)
      ).post(
        `/educator/students/${linkedClient}/workouts/${draft.id}/activate`,
      );
      expect(activated.status).toBeLessThan(300);

      const after = await (
        await as(studentAccount)
      ).get('/me/physical-educator');
      expect(after.body.todayWorkout.todaySessionId ?? null).toBeNull();
      const reads = await (
        await as(studentAccount)
      ).get('/me/educator-workouts');
      expect(reads.body.workouts[0].todaySessionId ?? null).toBeNull();
    });

    it('IT-013 resolves two linked educators to the most recently linked one', async () => {
      const recent = await createStudent(
        'Second Record',
        studentAccount,
        educatorTwo,
      );
      expect(recent).toBeDefined();
      const mirror = await (
        await as(studentAccount)
      ).get('/me/physical-educator');
      expect(mirror.body.professional.id).toBe(educatorTwo.id);
    });
  });

  describe('merged upcoming and linking (IT-012)', () => {
    it('merges bookings and fixed sessions, labels each educator, and shows a late-linked record with no earlier notice', async () => {
      clock.at = brt(10, 7, 10);
      const withEducatorOne = await createStudent(
        'Upcoming One',
        studentAccount,
        educator,
      );
      const withEducatorTwo = await createStudent(
        'Upcoming Two',
        studentAccount,
        educatorTwo,
      );
      expect(
        (
          await createRule(educator, withEducatorOne, {
            weekday: 4,
            startMinute: 18 * 60,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await createRule(educatorTwo, withEducatorTwo, {
            weekday: 5,
            startMinute: 18 * 60,
          })
        ).status,
      ).toBe(201);
      await prisma.slot.create({
        data: {
          professionalId: educator.id,
          startAt: brt(10, 12, 10),
          endAt: brt(10, 12, 11),
          status: 'BOOKED',
          type: 'PRESENCIAL',
          userId: studentAccount.id,
        },
      });

      const upcoming = await (
        await as(studentAccount)
      ).get('/scheduling/upcoming');
      expect(upcoming.status).toBe(200);
      const items = upcoming.body as Array<{
        source: string;
        counterpart?: { name: string };
      }>;
      expect(items.some((item) => item.source === 'BOOKING')).toBe(true);
      const fixed = items.filter((item) => item.source === 'FIXED');
      const names = fixed.map((item) => item.counterpart?.name);
      expect(names).toEqual(
        expect.arrayContaining(['Thiago Ramos', 'Carla Lima']),
      );

      const unlinked = await createStudent('Late Link', null, educator);
      expect(
        (
          await createRule(educator, unlinked, {
            weekday: 1,
            startMinute: 7 * 60,
          })
        ).status,
      ).toBe(201);
      const educatorView = await (
        await as(educator)
      ).get('/scheduling/upcoming');
      expect(
        (educatorView.body as Array<{ source: string }>).some(
          (item) => item.source === 'FIXED',
        ),
      ).toBe(true);

      const noticesBefore = await countNotifications(
        otherAccount.id,
        'SCHEDULE_CHANGE',
      );
      const link = await (
        await as(educator)
      ).patch(`/educator/students/${unlinked}`, {
        email: otherAccount.email,
        linkExistingAccount: true,
      });
      expect(link.status).toBe(200);
      expect(await countNotifications(otherAccount.id, 'SCHEDULE_CHANGE')).toBe(
        noticesBefore,
      );

      const linkedView = await (
        await as(otherAccount)
      ).get('/scheduling/upcoming');
      expect(
        (linkedView.body as Array<{ source: string }>).some(
          (item) => item.source === 'FIXED',
        ),
      ).toBe(true);
    });
  });

  describe('removal cascade (IT-016)', () => {
    it('removing a student deletes their fixed times and sessions, empties their reads and frees the hidden slot', async () => {
      clock.at = brt(10, 7, 10);
      const removedAccount = await createUser(
        'removed',
        'Removed Account',
        null,
      );
      const client = await createStudent('Removed Student', removedAccount);
      const rule = await createRule(educator, client, {
        weekday: 6,
        startMinute: 10 * 60,
      });
      expect(rule.status).toBe(201);

      const slot = await prisma.slot.create({
        data: {
          professionalId: educator.id,
          startAt: brt(10, 10, 10),
          endAt: brt(10, 10, 11),
          status: 'OPEN',
        },
      });
      const listing = async () => {
        const from = brt(10, 9, 0).toISOString();
        const to = brt(10, 11, 0).toISOString();
        const response = await (
          await as(studentAccount)
        ).get(
          `/scheduling/slots?professionalId=${educator.id}&from=${from}&to=${to}`,
        );
        return (response.body as Array<{ id: string }>).map((s) => s.id);
      };
      expect(await listing()).not.toContain(slot.id);

      const removed = await (
        await as(educator)
      ).delete(`/educator/students/${client}`);
      expect(removed.status).toBe(204);
      expect(
        await prisma.fixedTime.count({ where: { clientId: client } }),
      ).toBe(0);
      expect(
        await prisma.fixedSession.count({ where: { clientId: client } }),
      ).toBe(0);
      const upcoming = await (
        await as(removedAccount)
      ).get('/scheduling/upcoming');
      expect(
        (upcoming.body as Array<{ source: string }>).some(
          (item) => item.source === 'FIXED',
        ),
      ).toBe(false);
      expect(await listing()).toContain(slot.id);
    });

    it('a record removed before an account is linked leaves nothing to link', async () => {
      const unlinked = await createStudent('Never Linked', null);
      expect(
        (
          await createRule(educator, unlinked, {
            weekday: 7,
            startMinute: 9 * 60,
          })
        ).status,
      ).toBe(201);
      const removed = await (
        await as(educator)
      ).delete(`/educator/students/${unlinked}`);
      expect(removed.status).toBe(204);
      expect(
        await prisma.client.findUnique({ where: { id: unlinked } }),
      ).toBeNull();
      expect(
        await prisma.fixedTime.count({ where: { clientId: unlinked } }),
      ).toBe(0);
    });
  });

  describe('role access (IT-017)', () => {
    it('answers 401 without a session, 403 for other roles, and the same 404 for another educator', async () => {
      clock.at = brt(10, 7, 10);
      const client = await createStudent('Access Student', studentAccount);
      const rule = await createRule(educator, client, {
        weekday: 7,
        startMinute: 11 * 60,
      });
      expect(rule.status).toBe(201);
      const base = `/educator/students/${client}/schedule`;

      const anon = anonymous();
      expect((await anon.get(base)).status).toBe(401);
      expect((await anon.post(`${base}/fixed-times`)).status).toBe(401);
      expect(
        (await anon.patch(`${base}/fixed-times/${rule.body.id}`)).status,
      ).toBe(401);
      expect(
        (await anon.delete(`${base}/fixed-times/${rule.body.id}`)).status,
      ).toBe(401);

      expect((await (await as(nutritionist)).get(base)).status).toBe(403);
      expect((await (await as(regularUser)).get(base)).status).toBe(403);

      const foreign = await (await as(educatorTwo)).get(base);
      const random = await (
        await as(educatorTwo)
      ).get('/educator/students/01890a5d-ac96-774b-bcce-b302099a8099/schedule');
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(random.body);

      const linked = await as(studentAccount);
      expect([403, 404]).toContain(
        (
          await linked.post(`${base}/fixed-times`, {
            weekday: 2,
            startMinute: 600,
            type: 'PRESENCIAL',
          })
        ).status,
      );
      expect([403, 404]).toContain(
        (
          await linked.patch(`${base}/fixed-times/${rule.body.id}`, {
            durationMinutes: 30,
          })
        ).status,
      );
      expect([403, 404]).toContain(
        (await linked.delete(`${base}/fixed-times/${rule.body.id}`)).status,
      );

      const own = await sessionAt(rule.body.id, brt(10, 11, 11));
      expect(
        (await linked.post(`/scheduling/fixed-sessions/${own!.id}/cancel`))
          .status,
      ).toBe(204);

      const other = await sessionAt(rule.body.id, brt(10, 18, 11));
      expect(
        (
          await (
            await as(otherAccount)
          ).post(`/scheduling/fixed-sessions/${other!.id}/cancel`)
        ).status,
      ).toBe(404);
    });
  });
});
