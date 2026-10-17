import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { ExecutionContext } from '@nestjs/common';
import { NutritionistGuard } from './nutritionist.guard';

function contextFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
  } as ExecutionContext;
}

describe('NutritionistGuard', () => {
  const findByIdWithProduct = jest.fn();
  const guard = new NutritionistGuard({
    findByIdWithProduct,
  } as unknown as UserRepository);

  beforeEach(() => jest.clearAllMocks());

  it('allows a NUTRITIONIST account', async () => {
    findByIdWithProduct.mockResolvedValue({
      product: { type: 'NUTRITIONIST' },
    });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
  });

  it('denies a PHYSICAL_EDUCATOR account (unlike ProfessionalGuard)', async () => {
    findByIdWithProduct.mockResolvedValue({
      product: { type: 'PHYSICAL_EDUCATOR' },
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies a plain USER account', async () => {
    findByIdWithProduct.mockResolvedValue({ product: { type: 'USER' } });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });

  it('denies when the user cannot be found', async () => {
    findByIdWithProduct.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      AppError,
    );
  });
});
