import { sortByWeekday } from '@/meal-plans/weekdayOrder';
import { MealPlanWithDays } from '@/repositories/meal-plans/mealPlans.repository';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { MealPlanStatus } from '@prisma/client';
import { PdfIssuer } from '../pdfIssuer';
import { PdfHeader } from './pdfHeader';
import { WEEKDAY_LABELS } from './weekdayLabels';

const EMPTY_PLAN_LABEL = 'Nenhuma refeição cadastrada ainda.';
const DRAFT_BANNER_LABEL = 'RASCUNHO — ainda não publicado';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  draftBanner: { fontSize: 10, color: '#b45309', marginBottom: 8 },
  day: { marginBottom: 12 },
  dayTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meal: { marginBottom: 4 },
  mealLabel: { fontFamily: 'Helvetica-Bold' },
  empty: { fontSize: 11, color: '#666666' },
});

type MealPlanDay = MealPlanWithDays['days'][number];

// One weekday's meals, each showing its label/text verbatim (PRD: Content
// fidelity) — never truncated (US-001.EC-3, UT-003): `<Text>` wraps/paginates
// long content by default.
function MealPlanDaySection({ day }: { day: MealPlanDay }) {
  return (
    <View style={styles.day}>
      <Text style={styles.dayTitle}>{WEEKDAY_LABELS[day.weekday]}</Text>
      {day.meals.map((meal) => (
        <View key={meal.id} style={styles.meal}>
          <Text>
            <Text style={styles.mealLabel}>{meal.label}: </Text>
            {meal.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Pure function, no I/O (TechSpec: Core Interfaces). Exported separately
// from `renderMealPlanPdf` so unit tests can assert on the composed element
// tree (TechSpec: Testing Approach) instead of parsing the (possibly
// compressed) binary output. Only weekdays with at least one meal are shown
// (US-001.AC-1/AC-2) — an all-empty plan shows one explicit empty state
// instead (US-001.EC-2, UT-002), never a blank page.
export function buildMealPlanDocument(
  plan: MealPlanWithDays,
  issuer: PdfIssuer,
) {
  const days = sortByWeekday(plan.days).filter((day) => day.meals.length > 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader issuer={issuer} />
        {plan.status === MealPlanStatus.DRAFT && (
          <Text style={styles.draftBanner}>{DRAFT_BANNER_LABEL}</Text>
        )}
        {days.length === 0 ? (
          <Text style={styles.empty}>{EMPTY_PLAN_LABEL}</Text>
        ) : (
          days.map((day) => <MealPlanDaySection key={day.id} day={day} />)
        )}
      </Page>
    </Document>
  );
}

export async function renderMealPlanPdf(
  plan: MealPlanWithDays,
  issuer: PdfIssuer,
): Promise<Buffer> {
  return await renderToBuffer(buildMealPlanDocument(plan, issuer));
}
