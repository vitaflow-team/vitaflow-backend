// Core interfaces (TechSpec: Implementation Design — Core Interfaces).
export interface GeneratedPdf {
  filename: string;
  buffer: Buffer;
}

// Who is asking for a FormRecord's PDF (TechSpec: PdfExportService).
// `academiaId` is only ever present for the academia-side route (read off
// `req.user.academiaId`, mirroring AcademiaFormRecordsController) — absent
// for the professional-side route, exactly like that controller's own calls
// into FormRecordsService.
export interface FormRecordRequester {
  userId: string;
  academiaId?: string;
}

// Bundled to stay within vitaflow-code-standards' 3-positional-param cap
// (TechSpec's shorthand `exportMealPlanVersion(clientId, version,
// requesterId, asClient)` would be a 4th). `clientId` is only meaningful
// (and required) for the professional route — the client/mirror route
// resolves its own client via the linked-nutritionist lookup.
export interface ExportMealPlanVersionInput {
  version: number;
  requesterId: string;
  asClient: boolean;
  clientId?: string;
}
