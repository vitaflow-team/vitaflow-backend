import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Meal } from '@prisma/client';
import { MealsRepository } from './meals.repository';

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  const timestamp = new Date('2026-09-30T12:00:00.000Z');
  return {
    id: 'meal-1',
    userId: 'user-1',
    mealType: 'LUNCH',
    description: 'Arroz, feijão e frango',
    calories: 650,
    loggedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('MealsRepository', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const update = jest.fn();
  const del = jest.fn();
  let repository: MealsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealsRepository,
        {
          provide: PrismaService,
          useValue: {
            meal: { create, findUnique, findMany, update, delete: del },
          },
        },
      ],
    }).compile();
    repository = module.get(MealsRepository);
  });

  it('creates a meal for a user', async () => {
    const created = makeMeal();
    create.mockResolvedValue(created);

    const result = await repository.create('user-1', {
      mealType: 'LUNCH',
      description: 'Arroz, feijão e frango',
      calories: 650,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        mealType: 'LUNCH',
        description: 'Arroz, feijão e frango',
        calories: 650,
        userId: 'user-1',
      },
    });
    expect(result).toBe(created);
  });

  it('finds a meal by id', async () => {
    const meal = makeMeal();
    findUnique.mockResolvedValue(meal);

    await expect(repository.findById('meal-1')).resolves.toBe(meal);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'meal-1' } });
  });

  it("scopes findByUserAndDateRange to a single day and returns only that day's meals", async () => {
    const start = new Date('2026-09-30T00:00:00.000Z');
    const end = new Date('2026-10-01T00:00:00.000Z');
    const meals = [makeMeal({ id: 'meal-1' }), makeMeal({ id: 'meal-2' })];
    findMany.mockResolvedValue(meals);

    const result = await repository.findByUserAndDateRange(
      'user-1',
      start,
      end,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', loggedAt: { gte: start, lt: end } },
      orderBy: { loggedAt: 'asc' },
    });
    expect(result).toBe(meals);
  });

  it('updates a meal', async () => {
    const updated = makeMeal({ calories: 700 });
    update.mockResolvedValue(updated);

    const result = await repository.update('meal-1', { calories: 700 });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: { calories: 700 },
    });
    expect(result).toBe(updated);
  });

  it('deletes a meal', async () => {
    await repository.delete('meal-1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'meal-1' } });
  });
});
