// A student with an active plan and no recurring billing yet.
export interface EligibleRow {
  clientId: string;
  name: string;
  planName: string;
  referencePrice: unknown;
  hasTaxId: boolean;
}
