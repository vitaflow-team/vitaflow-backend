import { ProductType } from '@prisma/client';
import { AppError } from './app.erro';
import { toProductType } from './productType';

describe('toProductType', () => {
  it.each([
    ['USER', ProductType.USER],
    ['PHYSICAL_EDUCATOR', ProductType.PHYSICAL_EDUCATOR],
    ['NUTRITIONIST', ProductType.NUTRITIONIST],
  ])('UT-033 maps %s to its matching ProductType', (value, expected) => {
    expect(toProductType(value)).toBe(expected);
  });

  it.each([
    ['nutritionist', 'nutritionist'],
    ['ADMIN', 'ADMIN'],
    ['', '""'],
  ])('UT-034 rejects invalid product type %j', (value, expectedInMessage) => {
    expect(() => toProductType(value)).toThrow(expectedInMessage);
  });

  // standards-enforcement UT-002
  it('throws an AppError with status 400, not a raw Error', () => {
    let caught: unknown;
    try {
      toProductType('ADMIN');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).getStatus()).toBe(400);
  });
});
