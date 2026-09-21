import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlansQueryDTO } from './plans.Dto';

const validateQuery = (query: Record<string, unknown>) =>
  validate(plainToInstance(PlansQueryDTO, query));

describe('plan categories — PlansQueryDTO', () => {
  // UT-003
  it.each([['USUARIO'], ['NUTRICIONISTA'], ['EDUCADOR_FISICO']])(
    'accepts category=%s',
    async (category) => {
      await expect(validateQuery({ category })).resolves.toEqual([]);
    },
  );

  // UT-003
  it('accepts an omitted category', async () => {
    await expect(validateQuery({})).resolves.toEqual([]);
  });

  // UT-004 — a wrong case, an empty value and a repeated parameter (an
  // array once Express has parsed the query string) must all fail here so
  // the ValidationPipe answers 400 instead of the repository seeing them.
  it.each([
    ['a wrongly cased name', 'nutricionista'],
    ['an empty value', ''],
    ['an unknown name', 'ADMIN'],
    ['a repeated parameter', ['USUARIO', 'NUTRICIONISTA']],
  ])('rejects %s', async (_label, category) => {
    const errors = await validateQuery({ category });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('category');
    expect(errors[0].constraints).toHaveProperty('isIn');
  });
});
