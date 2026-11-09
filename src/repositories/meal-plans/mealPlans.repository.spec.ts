import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Weekday } from '@prisma/client';
import { MealInput, MealPlansRepository } from './mealPlans.repository';

const WEEKDAYS: Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
];

function makeDays(): Array<{ weekday: Weekday; meals: MealInput[] }> {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    meals: [{ label: 'Almoço', text: 'Arroz, feijão e frango' }],
  }));
}

describe('MealPlansRepository.replaceAllDaysMeals (UT-023, UT-024)', () => {
  const findUnique = jest.fn();
  const transaction = jest.fn();
  let repository: MealPlansRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealPlansRepository,
        {
          provide: PrismaService,
          useValue: {
            mealPlan: { findUnique },
            $transaction: transaction,
          },
        },
      ],
    }).compile();
    repository = module.get(MealPlansRepository);
  });

  it('UT-023 writes all 7 days inside one transaction, matching a subsequent read', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'day-id' });
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          mealPlanDay: { upsert },
          mealPlanMeal: { deleteMany, createMany },
        });
      },
    );
    const expected = { id: 'plan-1', days: [] };
    findUnique.mockResolvedValue(expected);

    const result = await repository.replaceAllDaysMeals('plan-1', makeDays());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(7);
    expect(createMany).toHaveBeenCalledTimes(7);
    expect(result).toBe(expected);
  });

  it('UT-024 a simulated failure on the 4th day aborts the whole write — the 5th-7th days are never attempted', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce({ id: 'day-1' })
      .mockResolvedValueOnce({ id: 'day-2' })
      .mockResolvedValueOnce({ id: 'day-3' })
      .mockRejectedValueOnce(new Error('simulated mid-write failure'));
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          mealPlanDay: { upsert },
          mealPlanMeal: { deleteMany, createMany },
        });
      },
    );

    await expect(
      repository.replaceAllDaysMeals('plan-1', makeDays()),
    ).rejects.toThrow('simulated mid-write failure');

    // Exactly the 4 days attempted before the failure — the transaction
    // callback never reaches the 5th-7th days, and Prisma's own
    // `$transaction` (asserted via IT-005 against a real database) rolls
    // back whatever the first 3 successful upserts in this callback wrote.
    expect(upsert).toHaveBeenCalledTimes(4);
    expect(createMany).toHaveBeenCalledTimes(3);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
