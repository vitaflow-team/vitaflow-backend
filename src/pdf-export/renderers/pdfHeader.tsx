import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfIssuer } from '../pdfIssuer';

// PRD ADR-007 / US-007: every PDF names Vitaflow, the issuer (when the
// document type has one) and the client — a missing display name falls
// back to a generic label rather than rendering blank (US-007.EC-1).
const GENERIC_ISSUER_LABEL = 'Profissional não identificado';
const GENERIC_CLIENT_LABEL = 'Cliente não identificado';

const styles = StyleSheet.create({
  header: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: '1pt solid #cccccc',
  },
  brand: { fontSize: 10, color: '#888888', marginBottom: 4 },
  issuer: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  client: { fontSize: 11, marginTop: 2 },
});

function labelOrFallback(value: string | null, fallback: string): string {
  return value !== null && value.trim().length > 0 ? value : fallback;
}

// Composed into all four renderers (TechSpec: System Architecture) — never
// duplicated per renderer.
export function PdfHeader({ issuer }: { issuer: PdfIssuer }) {
  return (
    <View style={styles.header}>
      <Text style={styles.brand}>Vitaflow</Text>
      {issuer.issuerName !== null && (
        <Text style={styles.issuer}>
          {labelOrFallback(issuer.issuerName, GENERIC_ISSUER_LABEL)}
        </Text>
      )}
      <Text style={styles.client}>
        Paciente: {labelOrFallback(issuer.clientName, GENERIC_CLIENT_LABEL)}
      </Text>
    </View>
  );
}
