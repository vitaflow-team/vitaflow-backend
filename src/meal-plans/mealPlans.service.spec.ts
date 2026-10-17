import {
  MealPlansRepository,
  MealPlanWithDays,
} from '@/repositories/meal-plans/mealPlans.repository';
import { MealPlanStatus, Weekday } from '@prisma/client';
import { MealPlansService } from './mealPlans.service';
import { MEAL_TEXT_MAX_LENGTH } from './mealPlanLimits.constants';

function plan(overrides: Partial<MealPlanWithDays> = {}): MealPlanWithDays {
  return {
    id: 'draft-1',
    clientId: 'client-1',
    status: MealPlanStatus.DRAFT,
    version: null,
    publishedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    days: [],
    ...overrides,
  };
}

function day(
  weekday: Weekday,
  meals: Array<{ id?: string; label: string; text: string }> = [],
) {
  return {
    id: `day-${weekday}`,
    mealPlanId: 'draft-1',
    weekday,
    meals: meals.map((m, i) => ({
      id: m.id ?? `meal-${weekday}-${i}`,
      dayId: `day-${weekday}`,
      position: i,
      label: m.label,
      text: m.text,
    })),
  };
}

describe('MealPlansService', () => {
  const repo = {
    findById: jest.fn(),
    findDraftByClient: jest.fn(),
    findLatestPublished: jest.fn(),
    findPublishedByVersion: jest.fn(),
    listVersions: jest.fn(),
    createDraft: jest.fn(),
    findDayWithClient: jest.fn(),
    replaceDayMeals: jest.fn(),
    publish: jest.fn(),
  };
  let service: MealPlansService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MealPlansService(repo as unknown as MealPlansRepository);
  });

  describe('getOrCreateDraft', () => {
    it('UT-037 creates a fresh DRAFT with no days when none exists and no published version exists', async () => {
      repo.findDraftByClient.mockResolvedValue(null);
      repo.findLatestPublished.mockResolvedValue(null);
      repo.createDraft.mockResolvedValue(plan({ days: [] }));

      const result = await service.getOrCreateDraft('client-1');

      expect(repo.createDraft).toHaveBeenCalledWith('client-1', []);
      expect(result.days).toEqual([]);
    });

    it('pre-fills a fresh draft from the latest published version', async () => {
      repo.findDraftByClient.mockResolvedValue(null);
      repo.findLatestPublished.mockResolvedValue(
        plan({
          status: MealPlanStatus.PUBLISHED,
          version: 1,
          days: [
            day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz e feijão' }]),
          ],
        }),
      );
      repo.createDraft.mockResolvedValue(
        plan({
          days: [
            day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz e feijão' }]),
          ],
        }),
      );

      await service.getOrCreateDraft('client-1');

      expect(repo.createDraft).toHaveBeenCalledWith('client-1', [
        {
          weekday: Weekday.MONDAY,
          meals: [{ label: 'Almoço', text: 'Arroz e feijão' }],
        },
      ]);
    });

    it('returns the existing draft without creating a new one', async () => {
      repo.findDraftByClient.mockResolvedValue(plan());

      await service.getOrCreateDraft('client-1');

      expect(repo.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('saveDay', () => {
    it('UT-038 saves two days independently, each with its own meals', async () => {
      repo.findById.mockResolvedValue(plan());
      repo.replaceDayMeals
        .mockResolvedValueOnce(
          plan({ days: [day(Weekday.MONDAY, [{ label: 'A', text: 'x' }])] }),
        )
        .mockResolvedValueOnce(
          plan({
            days: [
              day(Weekday.MONDAY, [{ label: 'A', text: 'x' }]),
              day(Weekday.SATURDAY, [{ label: 'B', text: 'y' }]),
            ],
          }),
        );

      await service.saveDay('draft-1', {
        weekday: Weekday.MONDAY,
        meals: [{ label: 'A', text: 'x' }],
      });
      const result = await service.saveDay('draft-1', {
        weekday: Weekday.SATURDAY,
        meals: [{ label: 'B', text: 'y' }],
      });

      expect(repo.replaceDayMeals).toHaveBeenNthCalledWith(
        1,
        'draft-1',
        Weekday.MONDAY,
        [{ label: 'A', text: 'x' }],
      );
      expect(repo.replaceDayMeals).toHaveBeenNthCalledWith(
        2,
        'draft-1',
        Weekday.SATURDAY,
        [{ label: 'B', text: 'y' }],
      );
      expect(result.days.map((d) => d.weekday)).toEqual([
        Weekday.MONDAY,
        Weekday.SATURDAY,
      ]);
    });

    it('UT-040 rejects a meal text beyond the configured max length, 400, no partial save', async () => {
      repo.findById.mockResolvedValue(plan());

      await expect(
        service.saveDay('draft-1', {
          weekday: Weekday.MONDAY,
          meals: [{ label: 'A', text: 'x'.repeat(MEAL_TEXT_MAX_LENGTH + 1) }],
        }),
      ).rejects.toMatchObject({ code: 'meal_text_too_long', status: 400 });
      expect(repo.replaceDayMeals).not.toHaveBeenCalled();
    });

    it('rejects saving a day on a PUBLISHED plan, even via a direct id', async () => {
      repo.findById.mockResolvedValue(
        plan({ status: MealPlanStatus.PUBLISHED, version: 1 }),
      );

      await expect(
        service.saveDay('published-1', { weekday: Weekday.MONDAY, meals: [] }),
      ).rejects.toMatchObject({
        code: 'meal_plan_draft_not_found',
        status: 404,
      });
      expect(repo.replaceDayMeals).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('UT-039 rejects publishing a plan with zero meals defined anywhere, 400 empty_plan', async () => {
      repo.findById.mockResolvedValue(
        plan({ days: [day(Weekday.MONDAY, []), day(Weekday.TUESDAY, [])] }),
      );

      await expect(service.publish('draft-1')).rejects.toMatchObject({
        code: 'empty_plan',
        status: 400,
      });
      expect(repo.publish).not.toHaveBeenCalled();
    });

    it('UT-044 assigns the next version, sets publishedAt, does not auto-create a new draft', async () => {
      repo.findById.mockResolvedValue(
        plan({ days: [day(Weekday.MONDAY, [{ label: 'A', text: 'x' }])] }),
      );
      repo.publish.mockResolvedValue({
        version: 3,
        publishedAt: new Date('2026-10-05T12:00:00.000Z'),
      });

      const result = await service.publish('draft-1');

      expect(result).toEqual({
        version: 3,
        publishedAt: '2026-10-05T12:00:00.000Z',
      });
      expect(repo.createDraft).not.toHaveBeenCalled();
    });

    it('UT-045 publishing with no changes since the last published version still succeeds, creating a new version', async () => {
      repo.findById.mockResolvedValue(
        plan({ days: [day(Weekday.MONDAY, [{ label: 'A', text: 'x' }])] }),
      );
      repo.publish.mockResolvedValue({
        version: 2,
        publishedAt: new Date('2026-10-06T12:00:00.000Z'),
      });

      const result = await service.publish('draft-1');

      expect(result.version).toBe(2);
      expect(repo.publish).toHaveBeenCalledWith('draft-1');
    });
  });

  describe('cloneDay', () => {
    it('UT-041 clones from a day in the same draft', async () => {
      repo.findById.mockResolvedValue(plan());
      repo.findDayWithClient.mockResolvedValue({
        ...day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz' }]),
        mealPlan: { clientId: 'client-1' },
      });
      repo.replaceDayMeals.mockResolvedValue(
        plan({
          days: [day(Weekday.FRIDAY, [{ label: 'Almoço', text: 'Arroz' }])],
        }),
      );

      await service.cloneDay('draft-1', 'day-MONDAY', Weekday.FRIDAY);

      expect(repo.replaceDayMeals).toHaveBeenCalledWith(
        'draft-1',
        Weekday.FRIDAY,
        [{ label: 'Almoço', text: 'Arroz' }],
      );
    });

    it('UT-042 clones from a day belonging to a past PUBLISHED version of the same client', async () => {
      repo.findById.mockResolvedValue(plan());
      repo.findDayWithClient.mockResolvedValue({
        ...day(Weekday.MONDAY, [{ label: 'Jantar', text: 'Sopa' }]),
        mealPlan: { clientId: 'client-1' },
      });
      repo.replaceDayMeals.mockResolvedValue(plan());

      await service.cloneDay('draft-1', 'published-day-1', Weekday.SUNDAY);

      expect(repo.replaceDayMeals).toHaveBeenCalledWith(
        'draft-1',
        Weekday.SUNDAY,
        [{ label: 'Jantar', text: 'Sopa' }],
      );
    });

    it('UT-043 cloning onto a target day with existing meals replaces them entirely', async () => {
      repo.findById.mockResolvedValue(plan());
      repo.findDayWithClient.mockResolvedValue({
        ...day(Weekday.MONDAY, [{ label: 'Novo', text: 'Conteúdo novo' }]),
        mealPlan: { clientId: 'client-1' },
      });
      repo.replaceDayMeals.mockResolvedValue(
        plan({
          days: [
            day(Weekday.FRIDAY, [{ label: 'Novo', text: 'Conteúdo novo' }]),
          ],
        }),
      );

      const result = await service.cloneDay(
        'draft-1',
        'day-MONDAY',
        Weekday.FRIDAY,
      );

      // replaceDayMeals always replaces the whole meal list — the old
      // "Velho" meal (simulated as already there before this call) would
      // have been passed as the pre-clone state, but is never part of the
      // meals array this call sends to the repository.
      expect(repo.replaceDayMeals).toHaveBeenCalledWith(
        'draft-1',
        Weekday.FRIDAY,
        [{ label: 'Novo', text: 'Conteúdo novo' }],
      );
      expect(result.days[0].meals).toEqual([
        expect.objectContaining({ label: 'Novo', text: 'Conteúdo novo' }),
      ]);
    });

    it('rejects cloning a source day that belongs to a different client', async () => {
      repo.findById.mockResolvedValue(plan({ clientId: 'client-1' }));
      repo.findDayWithClient.mockResolvedValue({
        ...day(Weekday.MONDAY, []),
        mealPlan: { clientId: 'client-2' },
      });

      await expect(
        service.cloneDay('draft-1', 'foreign-day', Weekday.FRIDAY),
      ).rejects.toMatchObject({
        code: 'source_day_foreign',
        status: 403,
      });
      expect(repo.replaceDayMeals).not.toHaveBeenCalled();
    });

    it('answers 404 for a source day that does not exist', async () => {
      repo.findById.mockResolvedValue(plan());
      repo.findDayWithClient.mockResolvedValue(null);

      await expect(
        service.cloneDay('draft-1', 'missing-day', Weekday.FRIDAY),
      ).rejects.toMatchObject({
        code: 'source_day_not_found',
        status: 404,
      });
    });
  });

  describe('listVersions / getVersion', () => {
    it('UT-046 listVersions returns both versions in descending order with correct publishedAt', async () => {
      repo.listVersions.mockResolvedValue([
        { version: 2, publishedAt: new Date('2026-10-10T00:00:00.000Z') },
        { version: 1, publishedAt: new Date('2026-10-01T00:00:00.000Z') },
      ]);

      const result = await service.listVersions('client-1');

      expect(result).toEqual([
        { version: 2, publishedAt: '2026-10-10T00:00:00.000Z' },
        { version: 1, publishedAt: '2026-10-01T00:00:00.000Z' },
      ]);
    });

    it('UT-047 listVersions for a client with no published plan yet returns an empty list', async () => {
      repo.listVersions.mockResolvedValue([]);

      const result = await service.listVersions('client-1');

      expect(result).toEqual([]);
    });

    it('getVersion answers 404 for a version that does not exist', async () => {
      repo.findPublishedByVersion.mockResolvedValue(null);

      await expect(service.getVersion('client-1', 99)).rejects.toMatchObject({
        code: 'meal_plan_version_not_found',
        status: 404,
      });
    });

    it('getVersion returns the requested version content', async () => {
      repo.findPublishedByVersion.mockResolvedValue(
        plan({
          status: MealPlanStatus.PUBLISHED,
          version: 1,
          days: [day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz' }])],
        }),
      );

      const result = await service.getVersion('client-1', 1);

      expect(result.days[0].meals[0]).toMatchObject({
        label: 'Almoço',
        text: 'Arroz',
      });
    });
  });
});
