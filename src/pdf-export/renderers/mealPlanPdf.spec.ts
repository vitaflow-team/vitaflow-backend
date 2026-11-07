import { MealPlanWithDays } from '@/repositories/meal-plans/mealPlans.repository';
import { MealPlanStatus, Weekday } from '@prisma/client';
import { collectRenderedText, renderedText } from './collectRenderedText.util';
import { buildMealPlanDocument, renderMealPlanPdf } from './mealPlanPdf';

function plan(overrides: Partial<MealPlanWithDays> = {}): MealPlanWithDays {
  return {
    id: 'plan-1',
    clientId: 'client-1',
    status: MealPlanStatus.PUBLISHED,
    version: 1,
    publishedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    days: [],
    ...overrides,
  };
}

function day(weekday: Weekday, meals: Array<{ label: string; text: string }>) {
  return {
    id: `day-${weekday}`,
    mealPlanId: 'plan-1',
    weekday,
    meals: meals.map((meal, position) => ({
      id: `meal-${weekday}-${position}`,
      dayId: `day-${weekday}`,
      position,
      label: meal.label,
      text: meal.text,
    })),
  };
}

describe('renderMealPlanPdf', () => {
  it('UT-001 renders every day/meal label and text, %PDF-prefixed', async () => {
    const allSevenDays = Object.values(Weekday).map((weekday) =>
      day(weekday, [{ label: 'Café da manhã', text: 'Aveia com frutas' }]),
    );
    const plan1 = plan({ days: allSevenDays });
    const issuer = { issuerName: 'Dra. Ana', clientName: 'João' };

    const buffer = await renderMealPlanPdf(plan1, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildMealPlanDocument(plan1, issuer));
    const weekdayLabels = [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ];
    for (const label of weekdayLabels) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Café da manhã');
    expect(text).toContain('Aveia com frutas');
  });

  it('UT-002 zero meals on every day shows an explicit empty state', async () => {
    const plan1 = plan({
      days: [day(Weekday.MONDAY, []), day(Weekday.TUESDAY, [])],
    });
    const issuer = { issuerName: 'Dra. Ana', clientName: 'João' };

    const buffer = await renderMealPlanPdf(plan1, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildMealPlanDocument(plan1, issuer));
    expect(text).toContain('Nenhuma refeição cadastrada ainda.');
  });

  it('UT-003 a very long meal text is fully present, not truncated', () => {
    const longText = 'A'.repeat(5000);
    const plan1 = plan({
      days: [day(Weekday.MONDAY, [{ label: 'Almoço', text: longText }])],
    });
    const issuer = { issuerName: 'Dra. Ana', clientName: 'João' };

    const tree = buildMealPlanDocument(plan1, issuer);
    const leaves = collectRenderedText(tree);
    expect(leaves).toContain(longText);
  });

  it('UT-004 shows a draft indicator for DRAFT, none for PUBLISHED', () => {
    const issuer = { issuerName: 'Dra. Ana', clientName: 'João' };
    const draftPlan = plan({
      status: MealPlanStatus.DRAFT,
      days: [day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz' }])],
    });
    const publishedPlan = plan({
      status: MealPlanStatus.PUBLISHED,
      days: [day(Weekday.MONDAY, [{ label: 'Almoço', text: 'Arroz' }])],
    });

    const draftText = renderedText(buildMealPlanDocument(draftPlan, issuer));
    const publishedText = renderedText(
      buildMealPlanDocument(publishedPlan, issuer),
    );

    expect(draftText).toContain('RASCUNHO');
    expect(publishedText).not.toContain('RASCUNHO');
  });
});
