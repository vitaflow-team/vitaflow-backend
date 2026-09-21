import { ProductType } from '@prisma/client';
import { toProductType } from './product-type';

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
});
