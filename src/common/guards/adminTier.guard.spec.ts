import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { BackofficeTier } from '@prisma/client';
import { AdminTierGuard } from './adminTier.guard';

function contextFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId } }),
    }),
  } as ExecutionContext;
}

describe('AdminTierGuard — platform-admin-access UT-023', () => {
  const findUnique = jest.fn();
  const guard = new AdminTierGuard({ findUnique } as unknown as UserRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows an ADMIN-tier staff member', async () => {
    findUnique.mockResolvedValue({ backofficeTier: BackofficeTier.ADMIN });

    await expect(guard.canActivate(contextFor('staff-1'))).resolves.toBe(true);
  });

  it('denies an EQUIPE-tier staff member, re-validated live every time', async () => {
    findUnique.mockResolvedValue({ backofficeTier: BackofficeTier.EQUIPE });

    await expect(guard.canActivate(contextFor('staff-1'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies a non-staff account (backofficeTier null)', async () => {
    findUnique.mockResolvedValue({ backofficeTier: null });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies when the user cannot be found', async () => {
    findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('ghost'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies an EQUIPE member immediately after being demoted from ADMIN, with no stale trust', async () => {
    findUnique.mockResolvedValueOnce({ backofficeTier: BackofficeTier.ADMIN });
    await expect(guard.canActivate(contextFor('staff-1'))).resolves.toBe(true);

    findUnique.mockResolvedValueOnce({ backofficeTier: BackofficeTier.EQUIPE });
    await expect(guard.canActivate(contextFor('staff-1'))).rejects.toThrow(
      AppError,
    );
  });
});
