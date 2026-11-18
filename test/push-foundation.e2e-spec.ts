/**
 * Integration tests for the push-notifications data foundation (task_01).
 *
 * Runs real repositories and the real schema against an isolated database:
 * the new enum values, the partial unique index on open re-engagement
 * episodes, the one-row-per-day cap key, and account deletion removing every
 * push-owned row.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { Prisma } from '@prisma/client';

jest.setTimeout(30_000);

const RUN_TAG = `push-foundation-${Date.now()}`;

describe('Push notifications foundation (integration)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.reengagementEpisode.deleteMany({
      where: { scopeKey: { startsWith: RUN_TAG } },
    });
    await prisma.reengagementPush.deleteMany({
      where: { userId: { startsWith: RUN_TAG } },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createUser(label: string) {
    const user = await prisma.users.create({
      data: {
        name: `Push foundation ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    userIds.push(user.id);
    return user;
  }

  it('IT-022 deleting an account removes its devices, preferences, settings, episodes, and cap rows', async () => {
    const user = await createUser('delete');
    const userId = user.id;
    await prisma.pushDevice.create({
      data: {
        userId,
        endpoint: `https://push.example/${RUN_TAG}-delete`,
        p256dh: 'p256dh',
        auth: 'auth',
      },
    });
    await prisma.pushCategoryPreference.create({
      data: { userId, category: 'MESSAGES', enabled: false },
    });
    await prisma.pushSettings.create({ data: { userId } });
    await prisma.reengagementEpisode.create({
      data: {
        userId,
        kind: 'DIARY_INACTIVITY',
        scopeKey: `${RUN_TAG}-delete-scope`,
      },
    });
    await prisma.reengagementPush.create({
      data: { userId, dateKey: new Date('2026-11-18') },
    });

    await new UserRepository(prisma).deleteAccount(userId);

    const counts = await Promise.all([
      prisma.pushDevice.count({ where: { userId } }),
      prisma.pushCategoryPreference.count({ where: { userId } }),
      prisma.pushSettings.count({ where: { userId } }),
      prisma.reengagementEpisode.count({ where: { userId } }),
      prisma.reengagementPush.count({ where: { userId } }),
      prisma.users.count({ where: { id: userId } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('IT-023 has the new enum values and allows one open episode per kind and scope', async () => {
    const categories = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"NotificationCategory"))::text AS value`;
    expect(categories.map((row) => row.value)).toEqual(
      expect.arrayContaining(['DIARY_REMINDER', 'CHECKIN_ABSENCE']),
    );

    const user = await createUser('episode');
    const data = {
      userId: user.id,
      kind: 'CHECKIN_ABSENCE' as const,
      scopeKey: `${RUN_TAG}-episode-scope`,
    };
    const first = await prisma.reengagementEpisode.create({ data });

    await expect(
      prisma.reengagementEpisode.create({ data }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.reengagementEpisode.update({
      where: { id: first.id },
      data: { endedAt: new Date() },
    });
    await expect(
      prisma.reengagementEpisode.create({ data }),
    ).resolves.toMatchObject({ endedAt: null });
  });

  it('IT-024 allows one cap row per user and date', async () => {
    const userId = `${RUN_TAG}-cap-user`;
    const day = new Date('2026-11-18');
    await prisma.reengagementPush.create({ data: { userId, dateKey: day } });

    await expect(
      prisma.reengagementPush.create({ data: { userId, dateKey: day } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await expect(
      prisma.reengagementPush.create({
        data: { userId, dateKey: new Date('2026-11-19') },
      }),
    ).resolves.toMatchObject({ userId });
  });
});
