import { PrismaService } from '@/database/prisma.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Logger } from '@nestjs/common';
import { TokenType, UsersToken } from '@prisma/client';
import { hashToken, TOKEN_TTL_MS, UserTokenService } from './userToken.service';

interface TokenWhere {
  id?: string;
  userID?: string;
  type?: TokenType;
  expiresAt?: { gt: Date };
}

function matches(row: UsersToken, where: TokenWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.userID !== undefined && row.userID !== where.userID) return false;
  if (where.type !== undefined && row.type !== where.type) return false;
  return !where.expiresAt || row.expiresAt > where.expiresAt.gt;
}

// Just enough of Prisma, backed by an in-memory table, to run the real
// UserTokenRepository and UserRepository token paths end to end.
function createInMemoryPrisma() {
  const rows = new Map<string, UsersToken>();
  let sequence = 0;
  const usersToken = {
    create: ({ data }: { data: UsersToken }) => {
      const row = { ...data, id: `row-${++sequence}` };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    deleteMany: ({ where }: { where: TokenWhere }) => {
      const doomed = [...rows.values()].filter((row) => matches(row, where));
      doomed.forEach((row) => rows.delete(row.id));
      return Promise.resolve({ count: doomed.length });
    },
    findUnique: ({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        [...rows.values()].find((row) => row.tokenHash === where.tokenHash) ??
          null,
      ),
  };
  const users = {
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: object }) =>
        Promise.resolve({ id: where.id, ...data }),
    ),
  };
  const prisma = {
    usersToken,
    users,
    $transaction: (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };
  return { rows, users, prisma: prisma as unknown as PrismaService };
}

describe('UserTokenService', () => {
  let db: ReturnType<typeof createInMemoryPrisma>;
  let tokens: UserTokenService;
  let userRepository: UserRepository;

  // The consuming step each flow performs after the lookup.
  async function activate(raw: string) {
    const token = await tokens.findLive(raw, TokenType.ACTIVATION);
    return token ? await userRepository.activateUserWithToken(token) : null;
  }

  async function changePassword(raw: string) {
    const token = await tokens.findLive(raw, TokenType.RECOVERY);
    return token
      ? await userRepository.updatePasswordWithToken(token, 'new-hash')
      : null;
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = createInMemoryPrisma();
    tokens = new UserTokenService(new UserTokenRepository(db.prisma));
    userRepository = new UserRepository(db.prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('issue', () => {
    it.each([
      [TokenType.ACTIVATION, 2],
      [TokenType.RECOVERY, 3],
    ])(
      'stores only the hash of a 256-bit %s token, expiring in %ih',
      async (type, hours) => {
        const before = Date.now();
        const raw = await tokens.issue('user-1', type);

        expect(Buffer.from(raw, 'base64url')).toHaveLength(32);
        const [row] = [...db.rows.values()];
        expect(row).toMatchObject({
          userID: 'user-1',
          type,
          tokenHash: hashToken(raw),
        });
        expect(JSON.stringify(row)).not.toContain(raw);
        expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
          hours * 60 * 60 * 1000,
        );
        expect(TOKEN_TTL_MS[type]).toBe(hours * 60 * 60 * 1000);
      },
    );

    it('invalidates the earlier token of the same type only (EC-1)', async () => {
      const stale = await tokens.issue('user-1', TokenType.ACTIVATION);
      const recovery = await tokens.issue('user-1', TokenType.RECOVERY);
      const fresh = await tokens.issue('user-1', TokenType.ACTIVATION);

      expect(db.rows.size).toBe(2);
      await expect(
        tokens.findLive(stale, TokenType.ACTIVATION),
      ).resolves.toBeNull();
      await expect(
        tokens.findLive(fresh, TokenType.ACTIVATION),
      ).resolves.not.toBeNull();
      await expect(
        tokens.findLive(recovery, TokenType.RECOVERY),
      ).resolves.not.toBeNull();
    });

    it('never gives two issuances the same value', async () => {
      const first = await tokens.issue('user-1', TokenType.ACTIVATION);
      const second = await tokens.issue('user-2', TokenType.ACTIVATION);

      expect(first).not.toEqual(second);
    });
  });

  it('UT-003 a freshly issued token consumes successfully once', async () => {
    const activation = await tokens.issue('user-1', TokenType.ACTIVATION);
    const recovery = await tokens.issue('user-1', TokenType.RECOVERY);

    await expect(activate(activation)).resolves.toMatchObject({
      id: 'user-1',
      active: true,
    });
    await expect(changePassword(recovery)).resolves.toMatchObject({
      id: 'user-1',
      password: 'new-hash',
    });
    expect(db.rows.size).toBe(0);
  });

  it('UT-004 rejects a second use of the same token', async () => {
    const raw = await tokens.issue('user-1', TokenType.RECOVERY);
    const token = await tokens.findLive(raw, TokenType.RECOVERY);

    await expect(changePassword(raw)).resolves.not.toBeNull();
    await expect(changePassword(raw)).resolves.toBeNull();
    // A concurrent use that looked the token up before it was consumed
    // still cannot apply it.
    await expect(
      userRepository.updatePasswordWithToken(token!, 'other-hash'),
    ).resolves.toBeNull();
    expect(db.users.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a token presented to the other flow', async () => {
    const raw = await tokens.issue('user-1', TokenType.ACTIVATION);

    await expect(changePassword(raw)).resolves.toBeNull();
    await expect(activate(raw)).resolves.not.toBeNull();
  });

  it('UT-005 rejects an expired token and removes it', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-28T10:00:00Z') });
    const raw = await tokens.issue('user-1', TokenType.ACTIVATION);
    const token = await tokens.findLive(raw, TokenType.ACTIVATION);

    jest.setSystemTime(new Date('2026-09-28T12:00:01Z'));

    await expect(activate(raw)).resolves.toBeNull();
    expect(db.rows.size).toBe(0);
    await expect(
      userRepository.activateUserWithToken(token!),
    ).resolves.toBeNull();
    expect(db.users.update).not.toHaveBeenCalled();
  });
});
