// Shared header input (PRD ADR-007 / US-007). `issuerName: null` means the
// document type has no professional/academia owner in its data model (the
// AI-generated Workout) — the header then shows only the client and
// Vitaflow's identity, never an invented issuer. An empty-string issuer or
// client name (a profile missing its display name) is handled by
// `pdfHeader.tsx`'s own fallback, not here.
export interface PdfIssuer {
  issuerName: string | null;
  clientName: string;
}
