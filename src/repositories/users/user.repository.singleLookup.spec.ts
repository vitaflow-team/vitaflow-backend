import { PrismaService } from '@/database/prisma.service';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UserRepository } from './user.repository';

const REMOVED_LOOKUPS = [
  'findAllByEmail',
  'findByEmailInsensitive',
  'findCustomerByEmailInsensitive',
  'findStaffByEmail',
];
const SRC_ROOT = join(__dirname, '..', '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

// unified-login-account ADR-008: one email is one account, found one way.
describe('UserRepository — the single email lookup', () => {
  const prisma = { users: { findFirst: jest.fn().mockResolvedValue(null) } };
  const repository = new UserRepository(prisma as unknown as PrismaService);

  it('UT-001: findByEmail is exact, case-insensitive, wildcard-escaped and unfiltered by isBackoffice', async () => {
    await repository.findByEmail('a_b%c@x.com');

    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'a\\_b\\%c@x.com', mode: 'insensitive' },
      },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it.each(REMOVED_LOOKUPS)(
    'UT-001: %s no longer exists on the repository',
    (method) => {
      expect(method in repository).toBe(false);
    },
  );

  it('UT-031: no source file refers to a removed lookup', () => {
    const offenders = sourceFiles(SRC_ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return REMOVED_LOOKUPS.some((method) => source.includes(method));
    });

    expect(offenders).toEqual([]);
  });

  it.each([
    'academia/invitations/academiaInvitation.service.ts',
    'educator-students/students/students.service.ts',
    'nutritionist-patients/nutritionistPatients.service.ts',
    'users/signin/signin.service.ts',
    'auth/auth.service.ts',
    'backoffice/staff/backofficeStaff.service.ts',
  ])('UT-031: %s resolves an account through findByEmail', (file) => {
    expect(readFileSync(join(SRC_ROOT, file), 'utf8')).toMatch(
      /\.findByEmail\(/,
    );
  });
});
