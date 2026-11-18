/**
 * Integration tests for the push API (push-notifications task_02).
 *
 * Runs the real PushController, services, repositories, AuthGuard and the
 * app's global ValidationPipe against an isolated database. Only the
 * `WebPushClient` is replaced, by a switchable fake (push configured or not).
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { PushController } from '@/push/push.controller';
import { PushDevicesService } from '@/push/pushDevices.service';
import { PushSettingsService } from '@/push/pushSettings.service';
import { WebPushClient } from '@/push/webPush.client';
import { PushCategoryPreferenceRepository } from '@/repositories/push/pushCategoryPreference.repository';
import { PushDeviceRepository } from '@/repositories/push/pushDevice.repository';
import { PushSettingsRepository } from '@/repositories/push/pushSettings.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductGroup, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `push-api-${Date.now()}`;
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' };
const endpointOf = (label: string) =>
  `https://push.example/${RUN_TAG}-${label}`;

const webPush = {
  configured: true,
  isConfigured: () => webPush.configured,
  getPublicKey: () => (webPush.configured ? 'test-public-key' : null),
};

describe('Push API (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let group: ProductGroup;
  const users: Record<string, Users> = {};
  const jwtSecret = 'push-api-integration-jwt-secret';

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
      controllers: [PushController],
      providers: [
        PrismaService,
        UserRepository,
        PushDeviceRepository,
        PushCategoryPreferenceRepository,
        PushSettingsRepository,
        PushDevicesService,
        PushSettingsService,
        AuthGuard,
        { provide: WebPushClient, useValue: webPush },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    group = await prisma.productGroup.create({
      data: { name: `${RUN_TAG} group` },
    });
    for (const type of [
      'USER',
      'NUTRITIONIST',
      'PHYSICAL_EDUCATOR',
      'ACADEMIA',
    ]) {
      users[type] = await createUserOfType(type as ProductType);
    }
    users.other = await createUserOfType('USER', 'other');
  });

  beforeEach(() => {
    webPush.configured = true;
  });

  afterEach(async () => {
    const ids = Object.values(users).map((user) => user.id);
    await prisma.pushDevice.deleteMany({
      where: {
        OR: [{ userId: { in: ids } }, { endpoint: { contains: RUN_TAG } }],
      },
    });
    await prisma.pushCategoryPreference.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.pushSettings.deleteMany({ where: { userId: { in: ids } } });
  });

  afterAll(async () => {
    await prisma.users.deleteMany({
      where: { id: { in: Object.values(users).map((user) => user.id) } },
    });
    await prisma.product.deleteMany({ where: { groupId: group.id } });
    await prisma.productGroup.delete({ where: { id: group.id } });
    await prisma.$disconnect();
    await app.close();
  });

  async function createUserOfType(
    type: ProductType,
    suffix = '',
  ): Promise<Users> {
    const label = `${type.toLowerCase()}${suffix}`;
    const product = await prisma.product.create({
      data: { name: `${RUN_TAG} ${label}`, price: 0, groupId: group.id, type },
    });
    return await prisma.users.create({
      data: {
        name: `Push ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: product.id,
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

  async function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    as: Users,
    body?: object,
  ) {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Authorization', await bearerFor(as));
    return body ? await req.send(body) : await req;
  }

  const register = (as: Users, label: string, extra: object = {}) =>
    call('post', '/push/devices', as, {
      endpoint: endpointOf(label),
      keys: KEYS,
      ...extra,
    });

  it('IT-002 reports push disabled when unconfigured and full settings when configured', async () => {
    webPush.configured = false;
    const disabled = await call('get', '/push/settings', users.USER);
    expect(disabled.status).toBe(200);
    expect(disabled.body).toEqual({ enabled: false });

    webPush.configured = true;
    const enabled = await call('get', '/push/settings', users.USER);
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      enabled: true,
      publicKey: 'test-public-key',
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
      diaryReminderTime: '19:00',
    });
    expect(enabled.body.categories).toEqual(
      expect.arrayContaining([
        { category: 'MESSAGES', enabled: true },
        { category: 'BILLING', enabled: false },
      ]),
    );
  });

  it('IT-003 registers a device once and creates a single row after a turn-off', async () => {
    expect((await register(users.USER, 'a')).status).toBe(204);
    expect((await register(users.USER, 'a')).status).toBe(204);

    const rows = await prisma.pushDevice.findMany({
      where: { userId: users.USER.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', p256dh: 'p256dh-key' });

    const off = await call('delete', '/push/devices', users.USER, {
      endpoint: endpointOf('a'),
    });
    expect(off.status).toBe(204);
    expect((await register(users.USER, 'a')).status).toBe(204);
    expect(
      await prisma.pushDevice.count({ where: { userId: users.USER.id } }),
    ).toBe(1);
  });

  it('IT-004 rejects a non-HTTPS endpoint, missing keys, and an unconfigured service', async () => {
    const insecure = await call('post', '/push/devices', users.USER, {
      endpoint: 'http://push.example/insecure',
      keys: KEYS,
    });
    expect(insecure.status).toBe(400);

    const noKeys = await call('post', '/push/devices', users.USER, {
      endpoint: endpointOf('nokeys'),
      keys: { auth: 'auth-key' },
    });
    expect(noKeys.status).toBe(400);

    webPush.configured = false;
    const unavailable = await register(users.USER, 'unconfigured');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('push_unavailable');
    expect(
      await prisma.pushDevice.count({ where: { userId: users.USER.id } }),
    ).toBe(0);
  });

  it('IT-005 hands the endpoint to the second account that registers it', async () => {
    await register(users.USER, 'shared');
    await register(users.other, 'shared');

    const rows = await prisma.pushDevice.findMany({
      where: { endpoint: endpointOf('shared') },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(users.other.id);
  });

  it('IT-006 keeps 10 devices and removes the oldest when an 11th registers', async () => {
    for (let index = 0; index < 11; index++) {
      expect((await register(users.USER, `many-${index}`)).status).toBe(204);
    }

    const rows = await prisma.pushDevice.findMany({
      where: { userId: users.USER.id },
    });
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.endpoint)).not.toContain(endpointOf('many-0'));
    expect(rows.map((row) => row.endpoint)).toContain(endpointOf('many-10'));
  });

  it('IT-007 turns a device off idempotently and keeps the account preferences', async () => {
    await register(users.USER, 'off');
    await call('put', '/push/categories/MESSAGES', users.USER, {
      enabled: false,
    });

    const first = await call('delete', '/push/devices', users.USER, {
      endpoint: endpointOf('off'),
    });
    const second = await call('delete', '/push/devices', users.USER, {
      endpoint: endpointOf('off'),
    });
    expect([first.status, second.status]).toEqual([204, 204]);
    expect(
      await prisma.pushDevice.count({ where: { endpoint: endpointOf('off') } }),
    ).toBe(0);

    const settings = await call('get', '/push/settings', users.USER);
    expect(settings.body.categories).toContainEqual({
      category: 'MESSAGES',
      enabled: false,
    });
  });

  it('IT-008 marks a device logged out and reactivates it on sync by the same user', async () => {
    await register(users.USER, 'logout');

    const out = await call('post', '/push/devices/logout', users.USER, {
      endpoint: endpointOf('logout'),
    });
    expect(out.status).toBe(204);
    expect(
      (await prisma.pushDevice.findUnique({
        where: { endpoint: endpointOf('logout') },
      }))!.status,
    ).toBe('LOGGED_OUT');

    const sync = await call('post', '/push/devices/sync', users.USER, {
      endpoint: endpointOf('logout'),
      keys: { p256dh: 'fresh', auth: 'fresh' },
    });
    expect(sync.status).toBe(200);
    expect(sync.body).toEqual({ active: true });
    expect(
      await prisma.pushDevice.findUnique({
        where: { endpoint: endpointOf('logout') },
      }),
    ).toMatchObject({ status: 'ACTIVE', p256dh: 'fresh' });
  });

  it('IT-009 does not reactivate or alter a device owned by another account', async () => {
    await register(users.USER, 'foreign');
    await call('post', '/push/devices/logout', users.USER, {
      endpoint: endpointOf('foreign'),
    });

    const sync = await call('post', '/push/devices/sync', users.other, {
      endpoint: endpointOf('foreign'),
      keys: KEYS,
    });
    expect(sync.status).toBe(200);
    expect(sync.body).toEqual({ active: false });
    expect(
      await prisma.pushDevice.findUnique({
        where: { endpoint: endpointOf('foreign') },
      }),
    ).toMatchObject({ userId: users.USER.id, status: 'LOGGED_OUT' });
  });

  it('IT-010 stores category choices and rejects inapplicable or unknown ones', async () => {
    const saved = await call('put', '/push/categories/MESSAGES', users.USER, {
      enabled: false,
    });
    expect(saved.status).toBe(204);
    const settings = await call('get', '/push/settings', users.USER);
    expect(settings.body.categories).toContainEqual({
      category: 'MESSAGES',
      enabled: false,
    });

    for (const category of ['CHURN_RISK_ALERT', 'WORKOUT_REMINDER', 'NOPE']) {
      const rejected = await call(
        'put',
        `/push/categories/${category}`,
        users.USER,
        { enabled: true },
      );
      expect(rejected.status).toBe(400);
    }

    await Promise.all([
      call('put', '/push/categories/BILLING', users.USER, { enabled: true }),
      call('put', '/push/categories/BILLING', users.USER, { enabled: false }),
    ]);
    expect(
      await prisma.pushCategoryPreference.count({
        where: { userId: users.USER.id, category: 'BILLING' },
      }),
    ).toBe(1);
  });

  it('IT-011 persists quiet hours and the diary reminder and rejects invalid times', async () => {
    const quiet = await call('put', '/push/quiet-hours', users.USER, {
      enabled: true,
      start: '21:00',
      end: '06:00',
    });
    const reminder = await call('put', '/push/diary-reminder', users.USER, {
      time: '20:30',
    });
    expect([quiet.status, reminder.status]).toEqual([204, 204]);

    const settings = await call('get', '/push/settings', users.USER);
    expect(settings.body.quietHours).toEqual({
      enabled: true,
      start: '21:00',
      end: '06:00',
    });
    expect(settings.body.diaryReminderTime).toBe('20:30');

    const badQuiet = await call('put', '/push/quiet-hours', users.USER, {
      enabled: true,
      start: '25:00',
      end: '06:00',
    });
    const badReminder = await call('put', '/push/diary-reminder', users.USER, {
      time: '19:10',
    });
    expect([badQuiet.status, badReminder.status]).toEqual([400, 400]);

    const after = await call('get', '/push/settings', users.USER);
    expect(after.body.quietHours.start).toBe('21:00');
    expect(after.body.diaryReminderTime).toBe('20:30');
  });

  it('IT-012 shows the invitation once, even for simultaneous claims', async () => {
    const first = await call('post', '/push/invitation/claim', users.USER);
    const second = await call('post', '/push/invitation/claim', users.USER);
    expect(first.body).toEqual({ show: true });
    expect(second.body).toEqual({ show: false });

    const concurrent = await Promise.all([
      call('post', '/push/invitation/claim', users.other),
      call('post', '/push/invitation/claim', users.other),
    ]);
    expect(concurrent.filter((response) => response.body.show)).toHaveLength(1);
  });

  it('IT-031 offers each account type its own categories with the documented defaults', async () => {
    const stateOf = async (type: string) => {
      const response = await call('get', '/push/settings', users[type]);
      return Object.fromEntries(
        response.body.categories.map(
          (item: { category: string; enabled: boolean }) => [
            item.category,
            item.enabled,
          ],
        ),
      );
    };

    const student = await stateOf('USER');
    expect(student).toMatchObject({
      DIARY_REMINDER: true,
      CHECKIN_ABSENCE: true,
      BILLING: false,
    });
    expect(student).not.toHaveProperty('CHURN_RISK_ALERT');

    const educator = await stateOf('PHYSICAL_EDUCATOR');
    expect(educator).toMatchObject({ CHURN_RISK_ALERT: false, MESSAGES: true });
    expect(educator).not.toHaveProperty('DIARY_REMINDER');

    expect(await stateOf('NUTRITIONIST')).not.toHaveProperty('CHECKIN_ABSENCE');

    const owner = await stateOf('ACADEMIA');
    expect(owner).toMatchObject({
      ACADEMIA_ACTIVITY: false,
      CHURN_RISK_ALERT: false,
    });
  });
});
