/**
 * Integration tests for PRD `scheduling` (task_02, backend).
 *
 * Runs the real AvailabilityController/BookingController/SchedulingService/
 * SchedulingRepository, AuthGuard, ProfessionalGuard, and the app's global
 * ValidationPipe against an isolated database. NotificationsService's real
 * wiring runs unmocked (only MailService is mocked at the boundary), the
 * same pattern every prior feature's e2e suite this session established.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MailService } from '@/mail/mail.service';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { SchedulingRepository } from '@/repositories/scheduling/scheduling.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AvailabilityController } from '@/scheduling/availability.controller';
import { BookingController } from '@/scheduling/booking.controller';
import { Clock } from '@/scheduling/clock.service';
import { ReminderCronService } from '@/scheduling/reminder-cron.service';
import { SchedulingService } from '@/scheduling/scheduling.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
jest.setTimeout(30_000);

const RUN_TAG = `sched-${Date.now()}`;

describe('Scheduling integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let reminderCron: ReminderCronService;
  let groupId: string;
  let professional: Users;
  let user: Users;
  let stranger: Users;
  const sendNotificationEmail = jest.fn();
  const jwtSecret = 'scheduling-integration-jwt-secret';

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
      controllers: [AvailabilityController, BookingController],
      providers: [
        FixedTimesRepository,
        FixedSessionsService,
        Clock,
        EducatorWorkoutsRepository,
        NotificationsService,
        NotificationsRepository,
        PrismaService,
        UserRepository,
        ClientsRepository,
        SchedulingRepository,
        Clock,
        SchedulingService,
        ReminderCronService,
        NotificationsRepository,
        NotificationsService,
        AuthGuard,
        ProfessionalGuard,
        { provide: MailService, useValue: { sendNotificationEmail } },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    reminderCron = moduleFixture.get(ReminderCronService);

    await seedUsers();
  });

  beforeEach(() => {
    sendNotificationEmail.mockReset();
  });

  afterEach(async () => {
    await prisma.slot.deleteMany({
      where: { professionalId: professional.id },
    });
    await prisma.availabilityWindow.deleteMany({
      where: { professionalId: professional.id },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [professional.id, user.id] } },
    });
  });

  afterAll(async () => {
    const userIds = [professional, user, stranger]
      .filter(Boolean)
      .map((u) => u.id);
    await prisma.client.deleteMany({
      where: { professionalId: professional.id },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
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

    professional = await createUser('professional', {
      productId: group.products[0].id,
    });
    user = await createUser('user', {});
    stranger = await createUser('stranger', {});

    await prisma.client.create({
      data: {
        name: user.name,
        email: user.email,
        phone: '',
        userId: user.id,
        professional: { connect: { id: professional.id } },
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Scheduling ${label}`,
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

  // Tomorrow's ISO weekday (1 Mon..7 Sun), BRT — a window published for this
  // day always generates at least one future slot within the next 4 weeks,
  // whatever day the suite happens to run on.
  function tomorrowIsoWeekday(): number {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const jsDay = tomorrow.getUTCDay();
    return jsDay === 0 ? 7 : jsDay;
  }

  async function publishWindow(): Promise<void> {
    await request(app.getHttpServer())
      .post('/scheduling/availability')
      .set('Authorization', await bearerFor(professional))
      .send({
        dayOfWeek: tomorrowIsoWeekday(),
        startMinute: 0,
        endMinute: 1439,
        sessionDurationMinutes: 45,
      });
  }

  async function anOpenSlotId(): Promise<string> {
    const from = new Date();
    const to = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
    const response = await request(app.getHttpServer())
      .get('/scheduling/slots')
      .query({
        professionalId: professional.id,
        from: from.toISOString(),
        to: to.toISOString(),
      })
      .set('Authorization', await bearerFor(user));
    return (response.body as Array<{ id: string }>)[0].id;
  }

  it('IT-001 publishing a window generates real Slot rows; removing it deletes the future unbooked ones', async () => {
    await publishWindow();

    const window = await prisma.availabilityWindow.findFirst({
      where: { professionalId: professional.id },
    });
    expect(window).not.toBeNull();

    const slotsBefore = await prisma.slot.findMany({
      where: { availabilityWindowId: window!.id },
    });
    expect(slotsBefore.length).toBeGreaterThan(0);

    const removed = await request(app.getHttpServer())
      .delete(`/scheduling/availability/${window!.id}`)
      .set('Authorization', await bearerFor(professional));
    expect(removed.status).toBe(204);

    const slotsAfter = await prisma.slot.findMany({
      where: { availabilityWindowId: window!.id },
    });
    expect(slotsAfter).toHaveLength(0);
  });

  it('IT-002 two genuinely concurrent booking requests for the same slot: exactly one succeeds, exactly one Slot ends up BOOKED', async () => {
    await publishWindow();
    const slotId = await anOpenSlotId();
    const userAuth = await bearerFor(user);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/scheduling/slots/${slotId}/book`)
        .set('Authorization', userAuth)
        .send({ type: 'PRESENCIAL' }),
      request(app.getHttpServer())
        .post(`/scheduling/slots/${slotId}/book`)
        .set('Authorization', userAuth)
        .send({ type: 'PRESENCIAL' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    expect(slot?.status).toBe('BOOKED');
  });

  it('IT-002b booking with no active relationship is refused (403)', async () => {
    await publishWindow();
    const slotId = await anOpenSlotId();

    const refused = await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotId}/book`)
      .set('Authorization', await bearerFor(stranger))
      .send({ type: 'PRESENCIAL' });

    expect(refused.status).toBe(403);
  });

  it('IT-003 cancellation by either party reopens the slot', async () => {
    await publishWindow();
    const slotIdForProfessional = await anOpenSlotId();
    await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotIdForProfessional}/book`)
      .set('Authorization', await bearerFor(user))
      .send({ type: 'PRESENCIAL' });

    const canceledByProfessional = await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotIdForProfessional}/cancel`)
      .set('Authorization', await bearerFor(professional));
    expect(canceledByProfessional.status).toBe(204);

    const reopened = await prisma.slot.findUnique({
      where: { id: slotIdForProfessional },
    });
    expect(reopened?.status).toBe('OPEN');
    expect(reopened?.userId).toBeNull();

    const slotIdForUser = await anOpenSlotId();
    await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotIdForUser}/book`)
      .set('Authorization', await bearerFor(user))
      .send({ type: 'ONLINE' });

    const canceledByUser = await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotIdForUser}/cancel`)
      .set('Authorization', await bearerFor(user));
    expect(canceledByUser.status).toBe(204);
  });

  it('IT-004 lists only OPEN slots for the professional within the given range', async () => {
    await publishWindow();
    const from = new Date();
    const to = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

    const response = await request(app.getHttpServer())
      .get('/scheduling/slots')
      .query({
        professionalId: professional.id,
        from: from.toISOString(),
        to: to.toISOString(),
      })
      .set('Authorization', await bearerFor(user));

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(
      response.body.every((slot: { status: string }) => slot.status === 'OPEN'),
    ).toBe(true);
  });

  it('IT-005 setting the online link is reflected on the upcoming-sessions read', async () => {
    await publishWindow();
    const slotId = await anOpenSlotId();
    await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotId}/book`)
      .set('Authorization', await bearerFor(user))
      .send({ type: 'ONLINE' });

    const linkSet = await request(app.getHttpServer())
      .patch(`/scheduling/slots/${slotId}/link`)
      .set('Authorization', await bearerFor(professional))
      .send({ link: 'https://meet.google.com/abc-defg-hij' });
    expect(linkSet.status).toBe(200);
    expect(linkSet.body.onlineLink).toBe(
      'https://meet.google.com/abc-defg-hij',
    );

    const upcoming = await request(app.getHttpServer())
      .get('/scheduling/upcoming')
      .set('Authorization', await bearerFor(user));
    const slot = upcoming.body.find((s: { id: string }) => s.id === slotId);
    expect(slot.onlineLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(slot.counterpart.id).toBe(professional.id);
  });

  it('a real booking creates a real Notification row for the professional', async () => {
    await publishWindow();
    const slotId = await anOpenSlotId();

    const booked = await request(app.getHttpServer())
      .post(`/scheduling/slots/${slotId}/book`)
      .set('Authorization', await bearerFor(user))
      .send({ type: 'PRESENCIAL' });
    expect(booked.status).toBe(201);

    const notification = await prisma.notification.findFirst({
      where: { userId: professional.id, category: 'CONSULTATION_REMINDER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    expect(notification?.message).toContain(user.name);
  });

  it('IT-006 a due reminder creates real Notification rows for both parties; invoking again does not duplicate them', async () => {
    const dueSlot = await prisma.slot.create({
      data: {
        professionalId: professional.id,
        userId: user.id,
        status: 'BOOKED',
        type: 'PRESENCIAL',
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 60 * 60 * 1000 + 45 * 60 * 1000),
      },
    });

    await reminderCron.sendDueReminders();

    const userNotifications = await prisma.notification.findMany({
      where: { userId: user.id, category: 'CONSULTATION_REMINDER' },
    });
    const professionalNotifications = await prisma.notification.findMany({
      where: { userId: professional.id, category: 'CONSULTATION_REMINDER' },
    });
    expect(userNotifications).toHaveLength(1);
    expect(professionalNotifications).toHaveLength(1);

    const reminded = await prisma.slot.findUnique({
      where: { id: dueSlot.id },
    });
    expect(reminded?.reminderSentAt).not.toBeNull();

    await reminderCron.sendDueReminders();

    const userNotificationsAfterSecondRun = await prisma.notification.findMany({
      where: { userId: user.id, category: 'CONSULTATION_REMINDER' },
    });
    expect(userNotificationsAfterSecondRun).toHaveLength(1);
  });
});
