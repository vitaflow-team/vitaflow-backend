import { BmiClassification, calculateBmi, classifyBmi } from '@/progress/bmi.util';
import { FormRecordWithValues } from '@/repositories/clinical-records/formRecords.repository';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { FormFieldType } from '@prisma/client';
import { PdfIssuer } from '../pdfIssuer';
import { PdfHeader } from './pdfHeader';

// US-005.EC-1 / Business Rules: an unanswered optional field shows this,
// never a silent omission.
const UNANSWERED_LABEL = 'Não respondido';
const EMPTY_TEMPLATE_LABEL = 'Nenhum campo cadastrado neste modelo.';

const BMI_CLASSIFICATION_LABELS: Record<BmiClassification, string> = {
  ABAIXO_DO_PESO: 'Abaixo do peso',
  PESO_NORMAL: 'Peso normal',
  SOBREPESO: 'Sobrepeso',
  OBESIDADE_GRAU_I: 'Obesidade grau I',
  OBESIDADE_GRAU_II: 'Obesidade grau II',
  OBESIDADE_GRAU_III: 'Obesidade grau III',
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  field: { marginBottom: 8 },
  fieldLabel: { fontFamily: 'Helvetica-Bold' },
  bmi: { fontSize: 11, marginTop: 8, fontFamily: 'Helvetica-Bold' },
  empty: { fontSize: 11, color: '#666666' },
});

type FormRecordValueRow = FormRecordWithValues['values'][number];

// `selectedOption` is rendered as-is (PRD Business Rules: Multiple-choice
// fidelity, UT-013) — never re-looked-up against the template's current
// `options`, which may have changed since the record was answered.
function formatValue(value: FormRecordValueRow): string {
  switch (value.fieldType) {
    case FormFieldType.SHORT_TEXT:
    case FormFieldType.LONG_TEXT:
      return value.textValue ?? UNANSWERED_LABEL;
    case FormFieldType.NUMBER:
      return value.numberValue !== null
        ? String(value.numberValue)
        : UNANSWERED_LABEL;
    case FormFieldType.YES_NO:
      if (value.boolValue === null) return UNANSWERED_LABEL;
      return value.boolValue ? 'Sim' : 'Não';
    case FormFieldType.MULTIPLE_CHOICE:
      return value.selectedOption ?? UNANSWERED_LABEL;
    default:
      return UNANSWERED_LABEL;
  }
}

// ADR-005: reuses the existing BMI computation (`calculateBmi`/`classifyBmi`,
// nutritionist-module ADR-002) over the record's own walked values — never a
// new formula, never a separate lookup. Only the first weight-tagged and
// first height-tagged value are used; either missing, or a non-positive
// value, means no BMI line (US-005.AC-3, UT-012).
function findBmi(
  values: FormRecordValueRow[],
): { value: number; classification: BmiClassification } | null {
  const weight = values.find((v) => v.weightRole && v.numberValue !== null);
  const height = values.find((v) => v.heightRole && v.numberValue !== null);
  if (!weight || !height) return null;
  if (weight.numberValue! <= 0 || height.numberValue! <= 0) return null;

  const bmi = calculateBmi(weight.numberValue!, height.numberValue);
  const classification = classifyBmi(bmi);
  if (bmi === null || classification === null) return null;
  return { value: bmi, classification };
}

function FormFieldRow({ value }: { value: FormRecordValueRow }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{value.fieldLabel}</Text>
      <Text>{formatValue(value)}</Text>
    </View>
  );
}

// Pure function, no I/O (TechSpec: Core Interfaces). Exported separately so
// unit tests can assert on the composed element tree instead of parsing the
// binary output. Walks `record.values` (already position-ordered by the
// repository) rather than `template.fields` directly: every field —
// answered or not — already has exactly one FormRecordValue row, frozen at
// write time (formRecords.service.ts's `resolveValues`), so this never
// re-joins back to the template (ADR-006).
export function buildFormRecordDocument(
  record: FormRecordWithValues,
  issuer: PdfIssuer,
) {
  const bmi = findBmi(record.values);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader issuer={issuer} />
        {record.values.length === 0 ? (
          <Text style={styles.empty}>{EMPTY_TEMPLATE_LABEL}</Text>
        ) : (
          record.values.map((value) => (
            <FormFieldRow key={value.id} value={value} />
          ))
        )}
        {bmi && (
          <Text style={styles.bmi}>
            IMC: {bmi.value} ({BMI_CLASSIFICATION_LABELS[bmi.classification]})
          </Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderFormRecordPdf(
  record: FormRecordWithValues,
  issuer: PdfIssuer,
): Promise<Buffer> {
  return await renderToBuffer(buildFormRecordDocument(record, issuer));
}
