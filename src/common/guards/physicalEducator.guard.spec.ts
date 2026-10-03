import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { PhysicalEducatorGuard } from './physicalEducator.guard';

function contextFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId } }),
    }),
  } as ExecutionContext;
}

function userOfType(type: ProductType | null) {
  return { id: 'user-1', product: type ? { type } : null };
}

describe('PhysicalEducatorGuard', () => {
  const findByIdWithProduct = jest.fn();
  const guard = new PhysicalEducatorGuard({
    findByIdWithProduct,
  } as unknown as UserRepository);

  beforeEach(() => jest.clearAllMocks());

  it('UT-028 allows a PHYSICAL_EDUCATOR account', async () => {
    findByIdWithProduct.mockResolvedValue(userOfType('PHYSICAL_EDUCATOR'));

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
    expect(findByIdWithProduct).toHaveBeenCalledWith('user-1');
  });

  it('UT-029 rejects a NUTRITIONIST with 403 not_physical_educator', async () => {
    findByIdWithProduct.mockResolvedValue(userOfType('NUTRITIONIST'));

    const attempt = guard.canActivate(contextFor('user-1'));

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({
      status: 403,
      reason: 'not_physical_educator',
    });
  });

  it.each([
    ['a regular user', userOfType('USER')],
    ['an account with no product', userOfType(null)],
    ['an unknown user', null],
  ])('UT-030 rejects %s with 403 not_physical_educator', async (_, user) => {
    findByIdWithProduct.mockResolvedValue(user);

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toMatchObject(
      { status: 403, reason: 'not_physical_educator' },
    );
  });
});
