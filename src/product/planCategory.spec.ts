import { ProductType } from '@prisma/client';
import { PLAN_CATEGORIES, PlanCategory, typeOfCategory } from './planCategory';

describe('plan categories — API names mapped onto the stored type', () => {
  // UT-001
  it.each([
    ['USUARIO', 'USER'],
    ['NUTRICIONISTA', 'NUTRITIONIST'],
    ['EDUCADOR_FISICO', 'PHYSICAL_EDUCATOR'],
  ] as [PlanCategory, ProductType][])('maps %s to %s', (category, expected) => {
    expect(typeOfCategory(category)).toBe(expected);
  });

  // UT-002 — an unknown value can never reach `typeOfCategory` because the
  // DTO rejects it first, so the guarantee worth pinning is that the list
  // holds exactly the three accepted names and none of them maps to
  // undefined (which is what a drift from the enum would look like).
  it('accepts exactly three categories, each mapping to a defined type', () => {
    expect(PLAN_CATEGORIES).toEqual([
      'USUARIO',
      'NUTRICIONISTA',
      'EDUCADOR_FISICO',
    ]);
    expect(PLAN_CATEGORIES).toHaveLength(3);

    for (const category of PLAN_CATEGORIES) {
      expect(typeOfCategory(category)).toBeDefined();
    }

    expect(new Set(PLAN_CATEGORIES.map(typeOfCategory)).size).toBe(3);
  });
});
