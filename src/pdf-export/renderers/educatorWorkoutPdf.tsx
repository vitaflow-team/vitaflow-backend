import { WorkoutTree } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfIssuer } from '../pdfIssuer';
import { PdfHeader } from './pdfHeader';

const NO_SESSIONS_LABEL = 'Nenhuma sessão cadastrada ainda.';
const NO_EXERCISES_LABEL = 'Nenhum exercício nesta sessão.';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  session: { marginBottom: 12 },
  sessionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  exercise: { fontSize: 11, marginBottom: 2 },
  empty: { fontSize: 11, color: '#666666' },
});

type EducatorWorkoutSession = WorkoutTree['sessions'][number];

// Every exercise's name, sets, reps, and load when the model stores one
// (US-004.AC-1) — works identically whether `exercise` was sourced from the
// Exercise Library or entered freely (both store these fields directly on
// EducatorWorkoutExercise, never only via the `exercise` relation).
function EducatorSessionSection({ session }: { session: EducatorWorkoutSession }) {
  return (
    <View style={styles.session}>
      <Text style={styles.sessionTitle}>{session.name}</Text>
      {session.exercises.length === 0 ? (
        <Text style={styles.empty}>{NO_EXERCISES_LABEL}</Text>
      ) : (
        session.exercises.map((exercise) => (
          <Text key={exercise.id} style={styles.exercise}>
            {exercise.name} — {exercise.sets}x{exercise.reps}
            {exercise.load ? ` · carga: ${exercise.load}` : ''}
          </Text>
        ))
      )}
    </View>
  );
}

// Pure function, no I/O (TechSpec: Core Interfaces). Exported separately so
// unit tests can assert on the composed element tree instead of parsing the
// binary output. Called from two sites — the educador's own export and the
// client's own export (UT-009) — with `issuer.issuerName` resolved
// differently by the caller in each case, but otherwise identical rendering.
export function buildEducatorWorkoutDocument(
  tree: WorkoutTree,
  issuer: PdfIssuer,
) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader issuer={issuer} />
        <Text style={styles.title}>{tree.title}</Text>
        {tree.sessions.length === 0 ? (
          <Text style={styles.empty}>{NO_SESSIONS_LABEL}</Text>
        ) : (
          tree.sessions.map((session) => (
            <EducatorSessionSection key={session.id} session={session} />
          ))
        )}
      </Page>
    </Document>
  );
}

export async function renderEducatorWorkoutPdf(
  tree: WorkoutTree,
  issuer: PdfIssuer,
): Promise<Buffer> {
  return await renderToBuffer(buildEducatorWorkoutDocument(tree, issuer));
}
