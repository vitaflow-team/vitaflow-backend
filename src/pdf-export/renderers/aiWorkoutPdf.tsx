import { WorkoutWithDetails } from '@/repositories/workouts/workouts.repository';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { FitnessGoal } from '@prisma/client';
import { PdfIssuer } from '../pdfIssuer';
import { PdfHeader } from './pdfHeader';
import { dayOfWeekLabel } from './weekdayLabels';

// UT-006: an exercise whose `exerciseId` was set to null (removed from the
// Exercise Library) still appears in its original position with this label,
// mirroring the on-screen handling — never a blank name.
const UNAVAILABLE_EXERCISE_LABEL =
  'Exercício indisponível (removido da biblioteca)';
const NO_EXERCISES_LABEL = 'Nenhum exercício neste dia.';

const FITNESS_GOAL_LABELS: Record<FitnessGoal, string> = {
  [FitnessGoal.WEIGHT_LOSS]: 'Perda de peso',
  [FitnessGoal.MUSCLE_GAIN]: 'Ganho de massa muscular',
  [FitnessGoal.CONDITIONING]: 'Condicionamento',
  [FitnessGoal.MAINTENANCE]: 'Manutenção',
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  meta: { fontSize: 11, marginBottom: 8 },
  explanation: { fontSize: 10, color: '#444444', marginBottom: 12 },
  day: { marginBottom: 12 },
  dayTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  exercise: { fontSize: 11, marginBottom: 2 },
  empty: { fontSize: 11, color: '#666666' },
});

type WorkoutDay = WorkoutWithDetails['days'][number];

// UT-007: a day with zero exercises still renders with an explicit
// indication, never a silently skipped day.
function AiWorkoutDaySection({ day }: { day: WorkoutDay }) {
  return (
    <View style={styles.day}>
      <Text style={styles.dayTitle}>{dayOfWeekLabel(day.dayOfWeek)}</Text>
      {day.exercises.length === 0 ? (
        <Text style={styles.empty}>{NO_EXERCISES_LABEL}</Text>
      ) : (
        day.exercises.map((exercise) => (
          <Text key={exercise.id} style={styles.exercise}>
            {exercise.exercise?.name ?? UNAVAILABLE_EXERCISE_LABEL} —{' '}
            {exercise.sets}x{exercise.reps}
          </Text>
        ))
      )}
    </View>
  );
}

// Pure function, no I/O (TechSpec: Core Interfaces). Exported separately so
// unit tests can assert on the composed element tree instead of parsing the
// binary output. `issuer.issuerName` is always null here — the AI Workout
// has no professional owner (US-007.AC-2).
export function buildAiWorkoutDocument(
  workout: WorkoutWithDetails,
  issuer: PdfIssuer,
) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader issuer={issuer} />
        <Text style={styles.meta}>
          Objetivo: {FITNESS_GOAL_LABELS[workout.goal]} · {workout.daysPerWeek}
          x por semana
        </Text>
        {workout.explanation.length > 0 && (
          <Text style={styles.explanation}>{workout.explanation}</Text>
        )}
        {workout.days.map((day) => (
          <AiWorkoutDaySection key={day.id} day={day} />
        ))}
      </Page>
    </Document>
  );
}

export async function renderAiWorkoutPdf(
  workout: WorkoutWithDetails,
  issuer: PdfIssuer,
): Promise<Buffer> {
  return await renderToBuffer(buildAiWorkoutDocument(workout, issuer));
}
